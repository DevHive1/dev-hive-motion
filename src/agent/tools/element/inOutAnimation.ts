/**
 * add_in_out_animation - one-call entrance + exit animation for an
 * element, plus the two specialised variants add_entrance_animation
 * (entrance only) and add_exit_animation (exit only).
 *
 * Why this exists: add_animation attaches a single keyframe animation
 * to one property (opacity/x/y/scale/rotation). For a "fade up and
 * fade down" effect, the agent had to call add_animation four times
 * (entrance opacity, entrance y, exit opacity, exit y) with manually-
 * computed startFrames and durations. Small local models regularly
 * mis-computed those values, particularly the exit timing - typically
 * placing the exit too late (it got clipped past scene end) or on a
 * property already in use (resulting in conflicting keyframes).
 *
 * This tool removes the math. The agent picks a named pattern
 * ("fade-up", "slide-in-left", "scale-pop") and the rest is derived:
 *   - which properties animate and what the from/to values are
 *   - the entrance duration (default 18f, configurable)
 *   - the exit duration (default 18f, configurable)
 *   - the exit startFrame (computed from element.durationInFrames
 *     and the configured exit duration, so it lands AT element end)
 *
 * Available patterns (the most-used designs) - kept short so the
 * agent doesn't need to memorise a long list. Each maps to a known
 * visual effect users describe in plain language.
 */

import { nanoid } from "nanoid";
import { sceneStore } from "../../../server/sceneStore";
import type { Animation } from "../../../schema/scene";

type Pattern =
  | "fade-in"
  | "fade-out"
  | "fade-up"
  | "fade-down"
  | "fade-left"
  | "fade-right"
  | "fade-in-out"
  | "slide-in-left"
  | "slide-in-right"
  | "slide-out-left"
  | "slide-out-right"
  | "scale-pop-in"
  | "scale-pop-in-out"
  | "bounce-in"
  | "none";

interface AddInOutAnimationArgs {
  sceneId: string;
  elementId: string;
  /**
   * Animation pattern. Determines which properties animate and
   * from/to values. See tool description for the full list.
   */
  pattern: Pattern;
  /**
   * Override the default entrance duration (frames). Default 18.
   * Use 28 for dramatic, 12 for snappy.
   */
  entranceDurationInFrames?: number;
  /**
   * Override the default exit duration (frames). Default 18.
   * Use 28 for dramatic, 12 for snappy.
   */
  exitDurationInFrames?: number;
  /**
   * Override the entrance easing. Default "easeOut".
   */
  entranceEasing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring" | "bounce" | "elastic";
  /**
   * Override the exit easing. Default "easeIn".
   */
  exitEasing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring" | "bounce" | "elastic";
  /**
   * When true, replaces any existing animations on the element with
   * the new ones. Default false (existing animations are kept; new
   * ones appended).
   */
  replaceExistingAnimations?: boolean;
}

interface AddInOutResult {
  elementId: string;
  pattern: Pattern;
  animationsAdded: Array<{
    id: string;
    property: string;
    from: number;
    to: number;
    startFrame: number;
    durationInFrames: number;
    easing: string;
  }>;
  /** True if existing animations were cleared. */
  replaced: boolean;
  /** Element's startFrame + durationInFrames at time of call. */
  elementWindow: { startFrame: number; durationInFrames: number };
}

/**
 * Resolve which properties / from / to values / easings the named
 * pattern implies. Returns a description per side ("in" / "out") so
 * we can tie the exit startFrame to the element's lifetime.
 */
interface PatternSpec {
  entrance: Array<{ property: "opacity" | "x" | "y" | "scale" | "rotation"; from: number; to: number; easing: AddInOutAnimationArgs["entranceEasing"] }>;
  exit: Array<{ property: "opacity" | "x" | "y" | "scale" | "rotation"; from: number; to: number; easing: AddInOutAnimationArgs["exitEasing"] }>;
}

const PATTERNS: Record<Pattern, PatternSpec> = {
  "fade-in": {
    entrance: [{ property: "opacity", from: 0, to: 1, easing: "easeOut" }],
    exit: [],
  },
  "fade-out": {
    entrance: [],
    exit: [{ property: "opacity", from: 1, to: 0, easing: "easeIn" }],
  },
  "fade-up": {
    entrance: [
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
      { property: "y", from: 6, to: 0, easing: "easeOut" },
    ],
    exit: [],
  },
  "fade-down": {
    entrance: [
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
      { property: "y", from: -6, to: 0, easing: "easeOut" },
    ],
    exit: [],
  },
  "fade-left": {
    entrance: [
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
      { property: "x", from: 6, to: 0, easing: "easeOut" },
    ],
    exit: [],
  },
  "fade-right": {
    entrance: [
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
      { property: "x", from: -6, to: 0, easing: "easeOut" },
    ],
    exit: [],
  },
  "fade-in-out": {
    entrance: [{ property: "opacity", from: 0, to: 1, easing: "easeOut" }],
    exit: [{ property: "opacity", from: 1, to: 0, easing: "easeIn" }],
  },
  "slide-in-left": {
    entrance: [
      { property: "x", from: 20, to: 0, easing: "easeOut" },
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
    ],
    exit: [],
  },
  "slide-in-right": {
    entrance: [
      { property: "x", from: -20, to: 0, easing: "easeOut" },
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
    ],
    exit: [],
  },
  "slide-out-left": {
    entrance: [],
    exit: [
      { property: "x", from: 0, to: -20, easing: "easeIn" },
      { property: "opacity", from: 1, to: 0, easing: "easeIn" },
    ],
  },
  "slide-out-right": {
    entrance: [],
    exit: [
      { property: "x", from: 0, to: 20, easing: "easeIn" },
      { property: "opacity", from: 1, to: 0, easing: "easeIn" },
    ],
  },
  "scale-pop-in": {
    entrance: [
      { property: "scale", from: 0.6, to: 1, easing: "spring" },
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
    ],
    exit: [],
  },
  "scale-pop-in-out": {
    entrance: [
      { property: "scale", from: 0.6, to: 1, easing: "spring" },
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
    ],
    exit: [
      { property: "scale", from: 1, to: 0.6, easing: "easeIn" },
      { property: "opacity", from: 1, to: 0, easing: "easeIn" },
    ],
  },
  "bounce-in": {
    entrance: [
      { property: "y", from: -10, to: 0, easing: "bounce" },
      { property: "opacity", from: 0, to: 1, easing: "easeOut" },
    ],
    exit: [],
  },
  none: { entrance: [], exit: [] },
};

async function applyPattern(args: AddInOutAnimationArgs, mode: "in" | "out" | "both"): Promise<AddInOutResult> {
  if (!args.sceneId) throw new Error("add_in_out_animation: sceneId is required.");
  if (!args.elementId) throw new Error("add_in_out_animation: elementId is required.");
  const pattern = PATTERNS[args.pattern];
  if (!pattern) {
    throw new Error(
      `add_in_out_animation: unknown pattern "${args.pattern}". Available: ${Object.keys(PATTERNS).join(", ")}.`,
    );
  }
  if (args.pattern === "none") {
    return {
      elementId: args.elementId,
      pattern: args.pattern,
      animationsAdded: [],
      replaced: false,
      elementWindow: { startFrame: 0, durationInFrames: 0 },
    };
  }

  const entranceDur = args.entranceDurationInFrames ?? 18;
  const exitDur = args.exitDurationInFrames ?? 18;
  const replaced = Boolean(args.replaceExistingAnimations);
  let elementStart = 0;
  let elementDur = 0;
  const added: AddInOutResult["animationsAdded"] = [];

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`add_in_out_animation: scene "${args.sceneId}" not found.`);
    const el = scene.elements.find((e) => e.id === args.elementId);
    if (!el) {
      const known = scene.elements.map((e) => `${e.id} ("${e.name}")`).join(", ");
      throw new Error(
        `add_in_out_animation: element "${args.elementId}" not found in scene "${args.sceneId}". Available: ${known || "(none)"}.`,
      );
    }
    elementStart = el.startFrame ?? 0;
    elementDur = el.durationInFrames ?? 0;

    if (replaced) {
      el.animations = [];
    }

    // Computed exit startFrame: the animation should END at elementStart + elementDur.
    // exit.startFrame = (elementStart + elementDur) - exitDur.
    // Clamp to >= el.startFrame so we don't write a negative frame.
    const exitStartFrame = Math.max(
      elementStart,
      elementStart + elementDur - exitDur,
    );

    const write = (side: "in" | "out", spec: PatternSpec["entrance"][number], easingOverride: AddInOutAnimationArgs["entranceEasing"] | AddInOutAnimationArgs["exitEasing"]) => {
      if (side === "in" && mode !== "in" && mode !== "both") return;
      if (side === "out" && mode !== "out" && mode !== "both") return;
      const easing = (easingOverride ?? spec.easing) as string;
      const startFrame = side === "in" ? elementStart : exitStartFrame;
      const dur = side === "in" ? entranceDur : exitDur;
      const anim: Animation = {
        id: `anim-${nanoid(6)}`,
        property: spec.property,
        from: spec.from,
        to: spec.to,
        startFrame,
        durationInFrames: dur,
        easing: easing as Animation["easing"],
      };
      el.animations.push(anim);
      added.push({
        id: anim.id,
        property: anim.property,
        from: anim.from,
        to: anim.to,
        startFrame: anim.startFrame,
        durationInFrames: anim.durationInFrames,
        easing: anim.easing,
      });
    };

    for (const spec of pattern.entrance) {
      write("in", spec, args.entranceEasing);
    }
    for (const spec of pattern.exit) {
      write("out", spec, args.exitEasing);
    }

    return draft;
  });

  return {
    elementId: args.elementId,
    pattern: args.pattern,
    animationsAdded: added,
    replaced,
    elementWindow: { startFrame: elementStart, durationInFrames: elementDur },
  };
}

export const addInOutAnimationDef = {
  type: "function",
  function: {
    name: "add_in_out_animation",
    description:
      "Attach a named-pattern entrance + exit (or just entrance / just exit) animation to one element in a single call. " +
      "Replaces up to four add_animation calls with manual timing math. " +
      "Available patterns: fade-in, fade-out, fade-up, fade-down, fade-left, fade-right, fade-in-out, slide-in-left, slide-in-right, slide-out-left, slide-out-right, scale-pop-in, scale-pop-in-out, bounce-in, none. " +
      "Each pattern handles opacity + x/y/scale + easing automatically. " +
      "The exit startFrame is computed from the element's startFrame + durationInFrames so the exit lands AT element end (no clipping). " +
      "pass entranceDurationInFrames / exitDurationInFrames to override defaults (18 each). " +
      "Pass replaceExistingAnimations:true to clear the element's existing animations before adding the new ones.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        elementId: { type: "string" },
        pattern: {
          type: "string",
          enum: Object.keys(PATTERNS),
        },
        entranceDurationInFrames: { type: "number", description: "Override the entrance duration. Default 18 (drama: 28, snappy: 12)." },
        exitDurationInFrames: { type: "number", description: "Override the exit duration. Default 18." },
        entranceEasing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut", "spring", "bounce", "elastic"], description: "Override the entrance easing. Default depends on pattern." },
        exitEasing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut", "spring", "bounce", "elastic"], description: "Override the exit easing. Default depends on pattern." },
        replaceExistingAnimations: { type: "boolean", description: "If true, clears any existing animations on the element before adding the new ones. Default false." },
      },
      required: ["sceneId", "elementId", "pattern"],
    },
  },
};

export const addInOutAnimationImpl = (args: any) => applyPattern(args, "both");

export const addEntranceAnimationDef = {
  ...addInOutAnimationDef,
  function: {
    name: "add_entrance_animation",
    description:
      "Attach just the entrance part of a named pattern to one element (e.g. 'fade-up'). Use this when the element should just appear and stay - no exit. " +
      "For entrance + exit, use add_in_out_animation. For exit-only, use add_exit_animation. " +
      "Available patterns (entrance variants only): fade-in, fade-up, fade-down, fade-left, fade-right, slide-in-left, slide-in-right, scale-pop-in, bounce-in.",
    parameters: addInOutAnimationDef.function.parameters,
  },
};
export const addEntranceAnimationImpl = (args: any) => applyPattern(args, "in");

export const addExitAnimationDef = {
  ...addInOutAnimationDef,
  function: {
    name: "add_exit_animation",
    description:
      "Attach just the exit part of a named pattern to one element (e.g. 'fade-out' / 'slide-out-right'). " +
      "The exit startFrame is computed automatically so the animation ends at the element's natural lifetime end - no manual math, no clipping. " +
      "For entrance + exit, use add_in_out_animation. For entrance-only, use add_entrance_animation. " +
      "Available patterns (exit variants only): fade-out, slide-out-left, slide-out-right, fade-in-out (used as exit-only).",
    parameters: addInOutAnimationDef.function.parameters,
  },
};
export const addExitAnimationImpl = (args: any) => applyPattern(args, "out");
