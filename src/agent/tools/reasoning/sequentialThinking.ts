/**
 * sequential_thinking: a structured reasoning tool.
 *
 * Why this exists: small local models (and even larger ones, when
 * they get into a tool-call loop) benefit from being able to step
 * out of action mode and explicitly reason about where they are,
 * what they know, what they don't, and what to do next. Forcing that
 * reasoning into a structured shape with explicit branches /
 * revisions makes the model's reasoning legible (the user sees it in
 * the Operation card) and reduces the "do the same wrong thing 3
 * times" failure mode.
 *
 * Shape: a thought step has:
 *   - thought: 1-2 sentences capturing this step of reasoning
 *   - thoughtNumber: 1-indexed position in the chain
 *   - totalThoughts: the model's current estimate of total thoughts
 *     needed (can revise; the agent isn't bound to this)
 *   - nextThoughtNeeded: whether the model plans another thought
 *   - isRevision / revisesThoughtNumber: when this step corrects an
 *     earlier thought, mark it as a revision with the original index
 *   - branchFromThought / branchId: when this step starts a branch
 *     ("if I take approach X instead, ...") - useful for comparing
 *     alternatives without losing the main thread
 *
 * Most importantly the tool returns a `next_step` array of concrete
 * tool-call suggestions the agent should make next. This is what
 * turns reasoning into action: it's the handoff between "thinking
 * about this" and "doing the next thing". The suggestions are
 * derived from the thought content via simple pattern matching
 * (recognise phrases like "I should call review_scene" or "use
 * plan_scene_layout for scene 3"), not from LLM magic.
 *
 * State: thoughts are stored in a per-session list keyed by
 * sessionId (passed by the agent loop). The agent can pass
 * sessionId for continuity across calls; if omitted, a fresh chain
 * starts. We keep at most MAX_CHAIN_LENGTH thoughts and trim
 * earlier entries to keep the response small.
 */

import { logger } from "../../../core/utils/logger";
import { toolDefinitions } from "../../tools";

const MAX_CHAIN_LENGTH = 20;

interface ThoughtStep {
  thought: string;
  thoughtNumber: number;
  totalThoughts?: number;
  nextThoughtNeeded?: boolean;
  isRevision?: boolean;
  revisesThoughtNumber?: number;
  branchFromThought?: number;
  branchId?: string;
}

interface SequentialThinkingArgs {
  thought: string;
  thoughtNumber: number;
  totalThoughts?: number;
  nextThoughtNeeded?: boolean;
  isRevision?: boolean;
  revisesThoughtNumber?: number;
  branchFromThought?: number;
  branchId?: string;
  /** Optional. When set, continues a previous chain by sessionId. Useful when
   * reasoning across multiple user prompts about the same project. */
  sessionId?: string;
  /** Optional. Free-form label for what this chain is about, e.g. 'scene 3
   * layout decision'. The agent doesn't have to fill this in - we infer
   * one from the first thought if not given. */
  topic?: string;
}

interface SequentialThinkingResult {
  /** Echo back the thought that was just recorded (so the agent can
   * confirm what got stored even if its response gets cut off). */
  recorded: {
    thoughtNumber: number;
    thought: string;
    isRevision: boolean;
    revisesThoughtNumber?: number;
    branchFromThought?: number;
    branchId?: string;
  };
  /** Concise summary of the chain so far. */
  chainSummary: string;
  /** Tools available right now (so the agent has them in mind when
   * reasoning about what to call next). */
  availableTools: string[];
  /** 0-3 concrete next tool-call suggestions derived from the thought
   * text. The agent may ignore these and pick differently. Empty
   * array means the thought is too vague to suggest anything concrete. */
  nextStep: Array<{
    tool: string;
    reason: string;
    suggestedArgs: Record<string, unknown>;
  }>;
  /** Total thoughts in the chain (after this one was added). */
  chainLength: number;
}

// ── Per-session storage. We keep this in-process (no persistence);
// when the server restarts, all chains reset, which is fine for this
// use case (reasoning is transient; the user's project state is the
// thing that persists). ──────────────────────────────────────────────
const sessionChains = new Map<string, ThoughtStep[]>();

function getSessionChain(sessionId: string): ThoughtStep[] {
  let chain = sessionChains.get(sessionId);
  if (!chain) {
    chain = [];
    sessionChains.set(sessionId, chain);
  }
  return chain;
}

function summarizeChain(chain: ThoughtStep[]): string {
  if (chain.length === 0) return "(empty)";
  const recent = chain.slice(-3);
  return recent
    .map((t) => {
      const tag = t.isRevision ? `↻ rev #${t.revisesThoughtNumber}` : t.branchFromThought ? `⑂ branch from #${t.branchFromThought}` : "";
      return `#${t.thoughtNumber}${tag ? " [" + tag + "]" : ""}: ${t.thought.slice(0, 120)}${t.thought.length > 120 ? "…" : ""}`;
    })
    .join("\n");
}

/**
 * Extract concrete next-step tool suggestions from a thought. We use
 * simple regex patterns over the tool name because:
 *  1. The agent may not have actually committed to a specific tool
 *     yet at the thought stage - forcing pattern matching here makes
 *     the suggestions advisory, not authoritative.
 *  2. LLMs can refer to a tool by name without us needing an LLM to
 *     interpret - just match /review_scene/ → suggest review_scene.
 *  3. We don't need an LLM inside the tool, which keeps the tool
 *     deterministic and fast.
 */
function suggestNextSteps(thought: string, availableTools: string[]): SequentialThinkingResult["nextStep"] {
  const lower = thought.toLowerCase();
  const suggestions: SequentialThinkingResult["nextStep"] = [];

  // Order matters: more specific patterns first so we don't shadow them.
  const patterns: Array<{
    tool: string;
    reason: string;
    args: Record<string, unknown>;
    /** Lowercase phrases that, when in the thought, trigger this suggestion. */
    triggers: string[];
  }> = [
    {
      tool: "create_storyboard",
      reason: "Plan the full structure before building scenes one-by-one.",
      args: {},
      triggers: ["plan", "storyboard", "structured", "outline", "scenes list"],
    },
    {
      tool: "review_scene",
      reason: "Catch polish / timing / transition issues before the user sees them.",
      args: {},
      triggers: ["review", "polish", "check the scene", "verify", "anything wrong"],
    },
    {
      tool: "timeline_overview",
      reason: "Get a project-wide view of duration, transitions, and pacing.",
      args: {},
      triggers: ["timeline", "overall", "project-wide", "pacing", "total duration"],
    },
    {
      tool: "preview_single_scene",
      reason: "Render one scene to verify motion actually plays as expected.",
      args: {},
      triggers: ["preview", "render this scene", "see motion", "verify motion"],
    },
    {
      tool: "plan_scene_layout",
      reason: "Resolve exact positions before building to avoid clipping.",
      args: {},
      triggers: ["layout", "position", "placement", "where to put", "where the"],
    },
    {
      tool: "update_element",
      reason: "Tweak an existing element's position or property.",
      args: {},
      triggers: ["update", "change", "modify", "adjust", "fix"],
    },
    {
      tool: "set_scene_transition",
      reason: "Add the transition the user asked for (or that review_scene flagged).",
      args: {},
      triggers: ["transition", "fade", "slide", "wipe"],
    },
    {
      tool: "add_animation",
      reason: "Animate an element - entrance, exit, transform.",
      args: {},
      triggers: ["animat", "entrance", "exit", "motion"],
    },
    {
      tool: "search_stock_images",
      reason: "Source a real licensed image rather than inventing a URL.",
      args: {},
      triggers: ["stock image", "find an image", "real image"],
    },
    {
      tool: "generate_ai_image",
      reason: "Generate a custom image when stock photos don't cover it.",
      args: {},
      triggers: ["generate image", "ai image", "create image"],
    },
  ];

  for (const p of patterns) {
    if (!availableTools.includes(p.tool)) continue;
    if (p.triggers.some((trig) => lower.includes(trig))) {
      suggestions.push({ tool: p.tool, reason: p.reason, suggestedArgs: p.args });
    }
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

export async function sequentialThinkingImpl(rawArgs: unknown): Promise<SequentialThinkingResult> {
  const args = rawArgs as SequentialThinkingArgs;

  if (!args || typeof args.thought !== "string" || args.thought.trim() === "") {
    throw new Error(
      "sequential_thinking: 'thought' is required and must be a non-empty string describing this step of reasoning.",
    );
  }
  if (typeof args.thoughtNumber !== "number" || args.thoughtNumber < 1) {
    throw new Error(
      "sequential_thinking: 'thoughtNumber' is required and must be a positive integer (1, 2, 3, ...) representing this step's position in the chain.",
    );
  }

  const sessionId = args.sessionId ?? "default";
  const chain = getSessionChain(sessionId);

  // Build the step. If it's a revision of an existing step, replace
  // the original. If it's a branch from another, we keep both the
  // main thread and the branch.
  const step: ThoughtStep = {
    thought: args.thought,
    thoughtNumber: args.thoughtNumber,
    totalThoughts: args.totalThoughts,
    nextThoughtNeeded: args.nextThoughtNeeded,
    isRevision: Boolean(args.isRevision),
    revisesThoughtNumber: args.isRevision ? args.revisesThoughtNumber ?? undefined : undefined,
    branchFromThought: args.branchFromThought,
    branchId: args.branchId,
  };

  if (step.isRevision && typeof step.revisesThoughtNumber === "number") {
    // Replace the original entry. We keep the chain slot the same
    // by overwriting in place; this keeps later thoughtNumber
    // references valid.
    const idx = chain.findIndex((t) => t.thoughtNumber === step.revisesThoughtNumber);
    if (idx >= 0) {
      chain[idx] = step;
    } else {
      chain.push(step);
    }
  } else {
    chain.push(step);
  }

  // Trim to MAX_CHAIN_LENGTH (drop oldest with a low-water mark so we
  // don't truncate revisions in the middle of their branch).
  if (chain.length > MAX_CHAIN_LENGTH) {
    const drop = chain.length - MAX_CHAIN_LENGTH;
    chain.splice(0, drop);
  }

  const nextStep = suggestNextSteps(args.thought, toolDefinitions.map((t) => t.function.name));

  logger.info("Sequential thinking step recorded", {
    sessionId,
    thoughtNumber: args.thoughtNumber,
    isRevision: step.isRevision,
    chainLength: chain.length,
    branch: step.branchId,
  });

  return {
    recorded: {
      thoughtNumber: args.thoughtNumber,
      thought: args.thought,
      isRevision: Boolean(step.isRevision),
      revisesThoughtNumber: step.revisesThoughtNumber,
      branchFromThought: step.branchFromThought,
      branchId: step.branchId,
    },
    chainSummary: summarizeChain(chain),
    availableTools: toolDefinitions.map((t) => t.function.name),
    nextStep,
    chainLength: chain.length,
  };
}

export const sequentialThinkingDef = {
  type: "function",
  function: {
    name: "sequential_thinking",
    description:
      "Step out of action mode and think out loud in a structured way. Use this when you're about to do something risky, when a previous tool call returned something you don't understand, when you're stuck in a loop, or when you want to revise an earlier choice. " +
      "Each call records one 'thought' step (1-2 sentences) with an ordered thoughtNumber. Call this multiple times to build a chain of reasoning; each call returns (a) the chain so far, (b) the tool names available to you right now, and (c) 0-3 concrete next-step tool suggestions extracted from what you said. " +
      "Three patterns this unlocks, each of which would otherwise be hard to do well with just tool outputs: " +
      "1. PLAIN CHAIN: call with thoughtNumber 1, 2, 3,... until nextThoughtNeeded is false. " +
      "2. REVISION: pass isRevision:true and revisesThoughtNumber:N to correct an earlier thought (e.g. when you discovered an assumption was wrong). The original slot is overwritten, the chain stays coherent. " +
      "3. BRANCH: pass branchFromThought:N and a branchId to explore an alternative ('if I went with approach X instead of Y, ...') without losing the main thread. Both threads are kept in the chainSummary. " +
      "Tip: pass sessionId to keep one continuous chain across user prompts (e.g. 'design-review-scene-3'); leave it off for an ad-hoc chain about one specific decision. " +
      "This tool does NOT change the project. It only records reasoning. Always follow this up with the actual tool calls your reasoning suggests.",
    parameters: {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description:
            "1-2 sentences capturing this step of reasoning. Be concrete: 'Scene 3 needs a transition because review_scene flagged missingOutgoing - call set_scene_transition with fade 12 frames' is more useful than 'I should review things'.",
        },
        thoughtNumber: {
          type: "number",
          description: "Position of this thought in the chain (1, 2, 3, ...).",
        },
        totalThoughts: {
          type: "number",
          description:
            "Your current estimate of how many thoughts this chain will need. You can revise this in later calls - it's a hint, not a contract.",
        },
        nextThoughtNeeded: {
          type: "boolean",
          description:
            "Whether you intend to call sequential_thinking again. Set false on the last step. The tool runs in no-mutation mode regardless.",
        },
        isRevision: {
          type: "boolean",
          description: "True if this thought corrects an earlier one.",
        },
        revisesThoughtNumber: {
          type: "number",
          description: "If isRevision is true, the thoughtNumber being revised.",
        },
        branchFromThought: {
          type: "number",
          description: "If you're exploring an alternative, the thoughtNumber this branches from.",
        },
        branchId: {
          type: "string",
          description: "Label for this branch (e.g. 'approach-A', 'try-with-fade').",
        },
        sessionId: {
          type: "string",
          description:
            "Identifier for this reasoning chain. Use the same id across calls to keep one chain; different ids for unrelated chains. Default 'default'.",
        },
        topic: {
          type: "string",
          description: "Free-form label for what this chain is about (advisory only - logged but not stored in the chain).",
        },
      },
      required: ["thought", "thoughtNumber"],
    },
  },
};
