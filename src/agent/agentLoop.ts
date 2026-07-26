import type { Message } from "ollama";
import { ollama, DEFAULT_OLLAMA_MODEL } from "./ollamaClient";
import { toolDefinitions, toolImplementations } from "./tools";
import { promptEngine } from "./prompt/PromptEngine";
import { ChainOfThought } from "./reasoning/ChainOfThought";
import { sceneStore } from "../store/compositionStore";
import { coerceToolCall } from "./coerce";

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "tool_error"; name: string; error: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

const MAX_ITERATIONS = 80;

export async function runAgent(
  userPrompt: string,
  history: Message[],
  onEvent: (event: AgentEvent) => void,
  model: string = DEFAULT_OLLAMA_MODEL,
  options?: {
    mentions?: Array<{ type: string; id: string; name: string }>;
    imageUrls?: string[];
  },
): Promise<Message[]> {
  const currentComp = sceneStore.get();

  // 1. Build dynamic system prompt using PromptEngine
  const systemPromptContent = promptEngine.build({
    composition: currentComp,
    userPrompt,
    conversationLength: history.length,
    availableTools: toolDefinitions.map((t) => t.function.name),
    mentions: options?.mentions,
    imageUrls: options?.imageUrls,
  });

  // 2. Perform Chain of Thought analysis & emit reasoning event
  const reasoning = ChainOfThought.analyze(userPrompt, currentComp);
  if (reasoning.notes.length > 0) {
    onEvent({
      type: "thinking",
      text: `Reasoning Strategy:\n- ${reasoning.notes.join("\n- ")}`,
    });
  }

  const base64Images = options?.imageUrls
    ?.map((url) => (url.includes(",") ? url.split(",")[1] : url))
    .filter(Boolean);

  const userMessage: Message = {
    role: "user",
    content: userPrompt,
    ...(base64Images && base64Images.length > 0 ? { images: base64Images } : {}),
  };

  const messages: Message[] = [
    { role: "system", content: systemPromptContent },
    ...history,
    userMessage,
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let response;
    try {
      response = await ollama.chat({
        model,
        messages,
        tools: toolDefinitions as any,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: "error", message: `Ollama request failed: ${message}` });
      return messages;
    }

    const { message } = response;
    messages.push(message);

    if (message.content) {
      onEvent({ type: "thinking", text: message.content });
    }

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      onEvent({ type: "final", text: message.content ?? "Done." });
      return messages;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      // Coerce stringified numbers/booleans to their proper types before
      // the tool sees them - small Ollama models sometimes pass "60"
      // instead of 60 in nested object args, which used to fail with
      // raw zod "Expected number, received string" errors that the
      // agent couldn't reason about. See src/agent/coerce.ts.
      const args = coerceToolCall(
        name,
        (call.function.arguments ?? {}) as Record<string, unknown>,
        toolDefinitions as unknown as readonly { function: { name: string; parameters?: Record<string, unknown> } }[],
      );
      onEvent({ type: "tool_call", name, args });

      const impl = toolImplementations[name];
      if (!impl) {
        const error = `Unknown tool "${name}"`;
        onEvent({ type: "tool_error", name, error });
        messages.push({ role: "tool", content: JSON.stringify({ error }) });
        continue;
      }

      try {
        const result = await impl(args);
        onEvent({ type: "tool_result", name, result });
        messages.push({ role: "tool", content: JSON.stringify(result) });
      } catch (err) {
        // Translate raw zod errors into actionable messages the model can
        // actually reason about. Without this, an "Expected number, received
        // string" at path scenes[11].elements[11].durationInFrames is
        // useless to a model - with this, it sees the exact field and the
        // reason, and knows to re-issue the call with a number.
        const raw = err instanceof Error ? err.message : String(err);
        const error = translateToolError(raw);
        onEvent({ type: "tool_error", name, error });
        messages.push({ role: "tool", content: JSON.stringify({ error }) });
      }
    }
  }

  onEvent({
    type: "error",
    message: `Stopped after ${MAX_ITERATIONS} steps without a final answer - request may be too large.`,
  });
  return messages;
}

/**
 * Translate a raw error message - often a ZodError JSON dump from
 * CompositionSchema.parse in the store - into a single human-readable
 * line. The model sees this and can re-issue a corrected call instead
 * of staring at a 200-line JSON zod report.
 */
function translateToolError(raw: string): string {
  // Try to parse as a zod issues array. The store wraps ZodError.message
  // as JSON.stringify of the issues array.
  type ZodIssue = {
    code?: string;
    expected?: string;
    received?: string;
    path?: Array<string | number>;
    message?: string;
  };
  let issues: ZodIssue[] | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      issues = parsed as ZodIssue[];
    } else if (
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { issues?: unknown }).issues)
    ) {
      issues = (parsed as { issues: ZodIssue[] }).issues;
    }
  } catch {
    // not JSON - fall through
  }

  if (issues && issues.length > 0) {
    const first = issues[0];
    const path = (first.path ?? []).map(String).join(".");
    if (first.code === "invalid_type" && first.expected && first.received) {
      const where = path ? `${path}` : "input";
      return `Invalid type at ${where}: expected ${first.expected}, got ${first.received}. Re-call with a proper ${first.expected} value.`;
    }
    if (first.code === "too_small" && first.message) {
      return `Value too small at ${path || "input"}: ${first.message}`;
    }
    if (first.code === "too_big" && first.message) {
      return `Value too large at ${path || "input"}: ${first.message}`;
    }
    if (first.message) {
      return `Validation failed at ${path || "input"}: ${first.message}`;
    }
  }

  // Not a zod error. Look for common patterns.
  if (raw.includes("not found") || raw.includes("Could not find")) {
    return `Reference not found. ${raw.split("\n")[0]}`;
  }
  if (raw.length > 400) {
    return raw.slice(0, 380) + "... (truncated)";
  }
  return raw;
}
