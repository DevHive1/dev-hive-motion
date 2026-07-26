/**
 * set_animation_timing - adjust the startFrame, durationInFrames, delay,
 * or easing of a single animation on an element. The current add_animation
 * tool only appends; to edit an existing animation you had to call
 * update_element with the full new animations array, which is fragile
 * (the agent has to know all the other animations' ids and properties).
 *
 * This tool takes the animation by id (or by index if no id is known)
 * and patches just the timing fields. Animations are addressed by id
 * because they're uniquely generated and the agent should keep them
 * from the add_animation return value.
 */

import { sceneStore } from "../../../server/sceneStore";

interface SetAnimationTimingArgs {
  sceneId: string;
  elementId: string;
  /** Animation id (preferred). Use the id returned by add_animation. */
  animationId?: string;
  /** 0-based position in the animations array, used if animationId is not given. */
  animationIndex?: number;
  startFrame?: number;
  durationInFrames?: number;
  delay?: number;
  easing?:
    | "linear"
    | "easeIn"
    | "easeOut"
    | "easeInOut"
    | "circIn"
    | "circOut"
    | "circInOut"
    | "backIn"
    | "backOut"
    | "backInOut";
}

export const setAnimationTimingDef = {
  type: "function",
  function: {
    name: "set_animation_timing",
    description:
      "Adjust the timing or easing of one existing animation on an element, without rebuilding the whole animations array. " +
      "Pass the animationId from the add_animation result, or pass animationIndex (0-based) as a fallback. " +
      "Only the fields you supply are changed. Use this to retime an entrance, delay an exit, or swap easings without losing the rest of the animation's definition.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene containing the element." },
        elementId: { type: "string", description: "The element whose animation to edit." },
        animationId: { type: "string", description: "The animation's id (preferred). Returned by add_animation." },
        animationIndex: { type: "number", description: "0-based position in the animations array. Used only if animationId is not given." },
        startFrame: { type: "number", description: "New startFrame in frames. Must be >= 0." },
        durationInFrames: { type: "number", description: "New duration in frames. Must be >= 1." },
        delay: { type: "number", description: "New delay in frames (added on top of startFrame). Must be >= 0." },
        easing: {
          type: "string",
          enum: ["linear", "easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut", "backIn", "backOut", "backInOut"],
          description: "New easing curve.",
        },
      },
      required: ["sceneId", "elementId"],
    },
  },
};

const EASING_SET = new Set([
  "linear", "easeIn", "easeOut", "easeInOut",
  "circIn", "circOut", "circInOut",
  "backIn", "backOut", "backInOut",
]);

export const setAnimationTimingImpl = async (rawArgs: any) => {
  const args = rawArgs as SetAnimationTimingArgs;
  if (typeof args.sceneId !== "string" || typeof args.elementId !== "string") {
    throw new Error("set_animation_timing: sceneId and elementId are required.");
  }
  if (!args.animationId && args.animationIndex === undefined) {
    throw new Error("set_animation_timing: pass either animationId (preferred) or animationIndex.");
  }

  const fieldsToPatch: string[] = [];
  if (args.startFrame !== undefined) {
    if (!Number.isFinite(args.startFrame) || args.startFrame < 0) {
      throw new Error("set_animation_timing: startFrame must be a finite number >= 0.");
    }
    fieldsToPatch.push("startFrame");
  }
  if (args.durationInFrames !== undefined) {
    if (!Number.isFinite(args.durationInFrames) || args.durationInFrames < 1) {
      throw new Error("set_animation_timing: durationInFrames must be a finite number >= 1.");
    }
    fieldsToPatch.push("durationInFrames");
  }
  if (args.delay !== undefined) {
    if (!Number.isFinite(args.delay) || args.delay < 0) {
      throw new Error("set_animation_timing: delay must be a finite number >= 0.");
    }
    fieldsToPatch.push("delay");
  }
  if (args.easing !== undefined) {
    if (!EASING_SET.has(args.easing)) {
      throw new Error(`set_animation_timing: easing "${args.easing}" is not one of: ${[...EASING_SET].join(", ")}.`);
    }
    fieldsToPatch.push("easing");
  }
  if (fieldsToPatch.length === 0) {
    return { ok: true, changed: false, note: "No timing fields supplied - nothing to change." };
  }

  let resolvedId = "";
  let patchApplied: Record<string, unknown> = {};
  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) {
      throw new Error(`set_animation_timing: scene "${args.sceneId}" not found.`);
    }
    const el = scene.elements.find((e) => e.id === args.elementId);
    if (!el) {
      throw new Error(`set_animation_timing: element "${args.elementId}" not found in scene "${args.sceneId}".`);
    }
    const animations = (el as { animations?: Array<{ id?: string; startFrame?: number; durationInFrames?: number; delay?: number; easing?: string }> }).animations;
    if (!Array.isArray(animations) || animations.length === 0) {
      throw new Error(
        `set_animation_timing: element "${args.elementId}" has no animations to edit. ` +
          `Use add_animation first.`,
      );
    }

    let anim: { id?: string; startFrame?: number; durationInFrames?: number; delay?: number; easing?: string } | undefined;
    if (args.animationId) {
      anim = animations.find((a) => a.id === args.animationId);
      if (!anim) {
        throw new Error(
          `set_animation_timing: animationId "${args.animationId}" not found on element "${args.elementId}". ` +
            `Pass animationIndex instead, or call add_animation to create a new one.`,
        );
      }
    } else {
      const idx = args.animationIndex as number;
      if (idx < 0 || idx >= animations.length) {
        throw new Error(
          `set_animation_timing: animationIndex ${idx} is out of range (element has ${animations.length} animation${animations.length === 1 ? "" : "s"}).`,
        );
      }
      anim = animations[idx];
    }

    const patch: Record<string, unknown> = {};
    for (const field of fieldsToPatch) {
      patch[field] = (args as unknown as Record<string, unknown>)[field];
    }
    Object.assign(anim, patch);
    resolvedId = anim.id ?? "(no-id)";
    patchApplied = patch;
    return draft;
  });

  return {
    ok: true,
    changed: true,
    animationId: resolvedId,
    applied: patchApplied,
  };
};
