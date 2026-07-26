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
    /** Persisted URLs for the same images (saved to public/uploads/). */
    savedImageUrls?: string[];
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
    savedImageUrls: options?.savedImageUrls,
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

  // Verification gate: track scenes that were built (add_scene /
  // build_scene) without a matching review_scene in the same loop.
  // When the agent tries to declare "done" while at least one scene
  // is unreviewed, we push a system-reminder back into the conversation
  // asking the agent to review those scenes first. This addresses a
  // real failure mode observed in production: small local models will
  // happily build 8 scenes and say "I'm done" without ever calling
  // review_scene - leaving the user to find every polish issue by eye.
  //
  // We ONLY nudge the agent; we don't refuse to let it finish. Two
  // nudges in a row means we accept the result as-is rather than
  // spinning forever on a model that won't review. This keeps the
  // "controlled freedom, professional bar" promise: guidance is strong,
  // refusal is not.
  const unReviewedScenes = new Set<string>();
  const completedSceneIds = new Set<string>();
  let reviewNudgesIssued = 0;
  const MAX_REVIEW_NUDGES = 1;

  // Sequential-thinking nudge gate. After each trigger tool
  // (create_storyboard, plan_scene_layout, add_scene, build_scene),
  // we push a system-reminder into the conversation suggesting the
  // agent call sequential_thinking before its next major decision.
  // This nudges the model into explicit reasoning at the three
  // inflection points where reasoning matters most: structuring the
  // project, resolving layout, and committing to a scene. Each nudge
  // fires at most once per project per trigger (we track sessionId
  // implicitly via the messages[] array - the nudge text doesn't
  // repeat if the same tool got called twice with the same intent).
  // The agent can ignore the nudge - it's guidance, not a gate.
  const sceneNudgeIssuedFor = new Set<string>();
  let storyboardNudgeIssued = false;
  let firstLayoutNudgeIssued = false;

  const pushReviewNudge = () => {
    const ids = [...unReviewedScenes];
    if (ids.length === 0) return false;
    const list = ids.map((id) => `"${id}"`).join(", ");
    messages.push({
      role: "user",
      content:
        `[SYSTEM REMINDER] You built ${ids.length} scene${ids.length === 1 ? "" : "s"} ` +
        `(${list}) without calling review_scene on them. The user will see ` +
        `layering problems, missing transitions, and "fake hold-then-reveal" ` +
        `timing if you skip this. Please call review_scene on each of these ` +
        `scene IDs and act on any flags it returns (set_scene_transition for ` +
        `missing transitions, update_element for layering, retiming the hero ` +
        `startFrame for hold-then-reveal). You can also use get_scene to see ` +
        `the full data of any one scene before deciding what to change. ` +
        `Then you're truly done.`,
    });
    reviewNudgesIssued++;
    return true;
  };

  /**
   * Push a system-reminder asking the agent to call sequential_thinking
   * before its next major decision. Three trigger points, each with its
   * own guidance specific to that decision. The agent can ignore the
   * reminder (it's a hint, not a gate) - but in practice small models
   * often forget to step out of action mode, and these nudges catch
   * that. We dedupe so the same nudge doesn't fire twice in one run.
   */
  const pushSequentialThinkingNudge = (kind: "storyboard" | "layout" | "scene", context?: { sceneId?: string; sceneName?: string }) => {
    let content: string;
    switch (kind) {
      case "storyboard":
        content =
          `[SYSTEM REMINDER - SEQUENTIAL THINKING] You just created the storyboard. Before building scenes, ` +
          `take 2-3 sequential_thinking steps to review the structure: ` +
          `(1) Does the scene count match the topic's depth? ` +
          `(2) Does the visual treatment vary scene-to-scene (no two scenes should look identical)? ` +
          `(3) Are the entranceCue / audioCue fields used where motion or sound matters? ` +
          `Then refine the storyboard with update_storyboard if you find gaps.`;
        break;
      case "layout":
        content =
          `[SYSTEM REMINDER - SEQUENTIAL THINKING] You just resolved the layout for a scene. Before ` +
          `committing to build_scene, take 2-3 sequential_thinking steps to verify: ` +
          `(1) Did the polish flags suggest any tweaks (z-ordering, off-canvas elements, missing ` +
          `incoming/outgoing transitions)? ` +
          `(2) Does the resolved x/y/width/height actually achieve what the presetRole intended ` +
          `(e.g. a 'headline' should be the visually dominant element, not buried)? ` +
          `(3) Will the entrance animations from animationPlan make the elements feel alive without ` +
          `clipping into each other? ` +
          `Apply any fixes via update_element / set_scene_transition / edit_timing BEFORE building.`;
        break;
      case "scene":
        content = `[SYSTEM REMINDER - SEQUENTIAL THINKING] You just built scene "${context?.sceneName ?? context?.sceneId ?? "?"}". ` +
          `Before moving to the next scene or declaring done, take 2-3 sequential_thinking steps: ` +
          `(1) Does this scene match its storyboard entry's contentNotes? ` +
          `(2) Does it have an incoming and outgoing transition (call set_scene_transition if ` +
          `review_scene flags them)? ` +
          `(3) Does the hero element start past frame 0 if the user described a "calm"/"hold"/"drift" ` +
          `opening (a hold-then-reveal needs a non-zero startFrame with a delayed entrance)? ` +
          `Then call review_scene and act on its flags before moving on.`;
        break;
    }
    messages.push({ role: "user", content });
  };

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
      // Agent is trying to declare done - check if every built scene was reviewed.
      // Only nudge if we haven't already nudged MAX_REVIEW_NUDGES times in
      // this loop. If the model ignores two nudges, accept the result and
      // let the user see it rather than loop forever.
      if (unReviewedScenes.size > 0 && reviewNudgesIssued < MAX_REVIEW_NUDGES) {
        pushReviewNudge();
        continue;
      }
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
        const result = (await impl(args)) as Record<string, unknown> | undefined;
        onEvent({ type: "tool_result", name, result });
        messages.push({ role: "tool", content: JSON.stringify(result) });

        // Verification gate bookkeeping: track when the agent builds
        // a scene or reviews one, so we can prompt for a final review
        // pass before letting the agent declare "done".
        if (result && typeof result === "object") {
          // add_scene / build_scene both return { sceneId }
          if ((name === "add_scene" || name === "build_scene") && typeof result.sceneId === "string") {
            completedSceneIds.add(result.sceneId);
            unReviewedScenes.add(result.sceneId);
            // Sequential-thinking nudge: after building a scene, the
            // model should reason about whether it serves the
            // storyboard before moving to the next one. We only
            // nudge once per scene in this run (deduped by sceneId).
            if (!sceneNudgeIssuedFor.has(result.sceneId)) {
              sceneNudgeIssuedFor.add(result.sceneId);
              const sceneName = typeof args.name === "string" ? args.name : undefined;
              pushSequentialThinkingNudge("scene", { sceneId: result.sceneId, sceneName });
            }
          }
          // remove_scene clears any pending review for that id
          if (name === "remove_scene" && typeof args.sceneId === "string") {
            unReviewedScenes.delete(args.sceneId);
            completedSceneIds.delete(args.sceneId);
            sceneNudgeIssuedFor.delete(args.sceneId);
          }
          // review_scene consumes the pending review for the scene it just reviewed
          if (name === "review_scene" && typeof args.sceneId === "string") {
            unReviewedScenes.delete(args.sceneId);
          }
          // timeline_overview implicitly reviews the whole composition
          // (it's a project-wide read-only check). Treat it as clearing
          // the unreviewed list - if the model remembered to call it,
          // it has at least looked at the project end-to-end.
          if (name === "timeline_overview") {
            for (const id of completedSceneIds) unReviewedScenes.delete(id);
          }
          // create_storyboard result triggers the storyboard-level
          // sequential_thinking nudge (at most once per run).
          if (name === "create_storyboard" && !storyboardNudgeIssued) {
            storyboardNudgeIssued = true;
            pushSequentialThinkingNudge("storyboard");
          }
          // plan_scene_layout result triggers a layout-level
          // sequential_thinking nudge the first time, so the agent
          // reviews the polish flags before committing. Subsequent
          // layout calls don't need a nudge - the model has the idea
          // by then.
          if (name === "plan_scene_layout" && !firstLayoutNudgeIssued) {
            firstLayoutNudgeIssued = true;
            pushSequentialThinkingNudge("layout");
          }
        }
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
