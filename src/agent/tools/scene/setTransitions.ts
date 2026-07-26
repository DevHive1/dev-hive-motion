/**
 * set_scene_transitions (plural) - set BOTH the INBOUND and OUTBOUND
 * transition for one scene in a single call.
 *
 * Why this exists: set_scene_transition only sets transitionIn. Most
 * users want a coordinated feel - "the scene fades in and fades out".
 * Without this tool, setting both ends required two calls (and a
 * mental note that setting transitionOut on scene N - 1 was the same
 * as setting transitionIn on scene N). Two calls had a hidden cost:
 * if the call between them errored, the scene ended up half-styled.
 *
 * This tool accepts both parameters and writes both fields atomically.
 * Either or both can be "none" (clearing an existing transition).
 */

import { sceneStore } from "../../../server/sceneStore";
import type { Transition } from "../../../schema/scene";

export type TransitionType = "fade" | "none" | "slide" | "wipe" | "flip" | "clockWipe" | "dissolve" | "crossZoom" | "dreamyZoom" | "filmBurn" | "zoomBlur" | "zoomInOut" | "iris" | "ripple" | "swap" | "linearBlur";
export type TransitionDirection = "from-left" | "from-right" | "from-top" | "from-bottom";

interface SetSceneTransitionsArgs {
  sceneId: string;
  /** Inbound transition (scene N comes in via this from scene N-1). */
  transitionIn?: {
    type: TransitionType;
    direction?: TransitionDirection;
    durationInFrames?: number;
  };
  /** Outbound transition (scene N leaves via this into scene N+1). */
  transitionOut?: {
    type: TransitionType;
    direction?: TransitionDirection;
    durationInFrames?: number;
  };
  /**
   * When true, applies the same transition (type, direction, duration)
   * to BOTH inbound and outbound. Convenience for "use fade on both
   * sides of this scene". Override individually with transitionIn /
   * transitionOut if needed.
   */
  bothEndsSame?: {
    type: TransitionType;
    direction?: TransitionDirection;
    durationInFrames?: number;
  };
  /** If true, applies the symmetric transition to the neighbouring scenes too
   * (the previous scene's transitionOut and the next scene's transitionIn
   * are also set to the same config). Useful when one user phrase like
   * 'every scene should cross-fade' should propagate automatically.
   */
  propagateToNeighbors?: boolean;
}

function buildTransition(input: { type: TransitionType; direction?: TransitionDirection; durationInFrames?: number }): Transition | undefined {
  if (input.type === "none") return undefined;
  return {
    type: input.type as Exclude<TransitionType, "none">,
    direction: (input.direction ?? "from-right") as TransitionDirection,
    durationInFrames: input.durationInFrames ?? 15,
  };
}

export const setSceneTransitionsDef = {
  type: "function",
  function: {
    name: "set_scene_transitions",
    description:
      "Set BOTH the inbound and outbound transitions for one scene in a single call. " +
      "Pass either or both of transitionIn / transitionOut to set them individually, OR pass bothEndsSame to apply the same config to both at once (e.g. 'fade on both sides of this scene'). " +
      "Also accepts propagateToNeighbors: when true, the previous scene's transitionOut and the next scene's transitionIn are also updated to the same config - use this when the user asks for a project-wide transition style ('every scene should fade'). " +
      "Pass type:'none' to clear an existing transition. " +
      "Use this instead of set_scene_transition when both ends matter - the singular tool only writes transitionIn, so it can't represent 'in is fade, out is none' or similar asymmetric requests.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        transitionIn: {
          type: "object",
          description: "Inbound transition config. Pass type:'none' to clear. Omit to leave unchanged.",
          properties: {
            type: { type: "string", enum: ["fade", "none", "slide", "wipe", "flip", "clockWipe", "dissolve", "crossZoom", "dreamyZoom", "filmBurn", "zoomBlur", "zoomInOut", "iris", "ripple", "swap", "linearBlur"] },
            direction: { type: "string", enum: ["from-left", "from-right", "from-top", "from-bottom"] },
            durationInFrames: { type: "number" },
          },
          required: ["type"],
        },
        transitionOut: {
          type: "object",
          description: "Outbound transition config. Pass type:'none' to clear. Omit to leave unchanged.",
          properties: {
            type: { type: "string", enum: ["fade", "none", "slide", "wipe", "flip", "clockWipe", "dissolve", "crossZoom", "dreamyZoom", "filmBurn", "zoomBlur", "zoomInOut", "iris", "ripple", "swap", "linearBlur"] },
            direction: { type: "string", enum: ["from-left", "from-right", "from-top", "from-bottom"] },
            durationInFrames: { type: "number" },
          },
          required: ["type"],
        },
        bothEndsSame: {
          type: "object",
          description: "Apply this config to BOTH the inbound and outbound transition. Convenience for 'fade in and fade out'.",
          properties: {
            type: { type: "string", enum: ["fade", "none", "slide", "wipe", "flip", "clockWipe", "dissolve", "crossZoom", "dreamyZoom", "filmBurn", "zoomBlur", "zoomInOut", "iris", "ripple", "swap", "linearBlur"] },
            direction: { type: "string", enum: ["from-left", "from-right", "from-top", "from-bottom"] },
            durationInFrames: { type: "number" },
          },
          required: ["type"],
        },
        propagateToNeighbors: {
          type: "boolean",
          description: "When true, also set the previous scene's transitionOut and the next scene's transitionIn to match. Only applies when bothEndsSame is provided.",
        },
      },
      required: ["sceneId"],
    },
  },
};

export const setSceneTransitionsImpl = async (rawArgs: unknown) => {
  const args = rawArgs as SetSceneTransitionsArgs;
  if (!args.sceneId) throw new Error("set_scene_transitions: sceneId is required.");
  if (!args.transitionIn && !args.transitionOut && !args.bothEndsSame) {
    throw new Error(
      "set_scene_transitions: pass at least one of transitionIn, transitionOut, or bothEndsSame.",
    );
  }

  const inConfig = args.transitionIn ?? (args.bothEndsSame ? { type: args.bothEndsSame.type, direction: args.bothEndsSame.direction, durationInFrames: args.bothEndsSame.durationInFrames } : undefined);
  const outConfig = args.transitionOut ?? (args.bothEndsSame ? { type: args.bothEndsSame.type, direction: args.bothEndsSame.direction, durationInFrames: args.bothEndsSame.durationInFrames } : undefined);

  let prevSceneIndex = -1;
  let nextSceneIndex = -1;
  let sceneIndex = -1;
  const transitioned: string[] = [];

  await sceneStore.update((draft) => {
    sceneIndex = draft.scenes.findIndex((s) => s.id === args.sceneId);
    if (sceneIndex === -1) {
      throw new Error(`set_scene_transitions: scene "${args.sceneId}" not found.`);
    }
    const scene = draft.scenes[sceneIndex];

    if (inConfig) {
      scene.transitionIn = buildTransition(inConfig);
      transitioned.push("transitionIn");
    }
    if (outConfig) {
      scene.transitionOut = buildTransition(outConfig);
      transitioned.push("transitionOut");
    }

    if (args.propagateToNeighbors && args.bothEndsSame && sceneIndex > 0) {
      prevSceneIndex = sceneIndex - 1;
      draft.scenes[sceneIndex - 1].transitionOut = buildTransition(args.bothEndsSame);
      transitioned.push(`prev.transitionOut`);
    }
    if (args.propagateToNeighbors && args.bothEndsSame && sceneIndex < draft.scenes.length - 1) {
      nextSceneIndex = sceneIndex + 1;
      draft.scenes[sceneIndex + 1].transitionIn = buildTransition(args.bothEndsSame);
      transitioned.push(`next.transitionIn`);
    }
    return draft;
  });

  return {
    ok: true,
    sceneId: args.sceneId,
    transitioned,
    preview: {
      transitionIn: inConfig ? buildTransition(inConfig) : undefined,
      transitionOut: outConfig ? buildTransition(outConfig) : undefined,
    },
  };
};
