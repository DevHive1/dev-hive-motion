import type { Message } from "ollama";
import { ollama, DEFAULT_OLLAMA_MODEL } from "./ollamaClient";
import { toolDefinitions, toolImplementations } from "./tools";
import { promptEngine } from "./prompt/PromptEngine";
import { ChainOfThought } from "./reasoning/ChainOfThought";
import { sceneStore } from "../store/compositionStore";

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
      const args = call.function.arguments as Record<string, unknown>;
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
        const error = err instanceof Error ? err.message : String(err);
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
