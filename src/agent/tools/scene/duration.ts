/**
 * edit_duration - change a single scene's durationInFrames without
 * touching anything else. The current alternative is update_element
 * with a giant patch, or batch_update_scenes, both of which require
 * the agent to either know the full scene object or to do a batch
 * pass when only one scene needs to be retimed.
 *
 * Use this for: "scene 3 is too short, give it 30 more frames",
 * "shorten scene 1 to 60 frames", "make the closing shot linger".
 *
 * The tool enforces a minimum duration of 1 frame and warns (does not
 * fail) if the new duration is shorter than any element's startFrame
 * + durationInFrames - the elements will simply be clipped.
 */

import { sceneStore } from "../../../server/sceneStore";

interface EditDurationArgs {
  sceneId: string;
  durationInFrames: number;
}

export const editDurationDef = {
  type: "function",
  function: {
    name: "edit_duration",
    description:
      "Change a single scene's duration without touching anything else. Use this when one scene needs to be retimed (too short, too long, or you want to hold a beat longer). " +
      "For a global pass across many scenes, prefer batch_update_scenes({ durationInFrames }). " +
      "Minimum is 1 frame; values under 5 are unusual and usually a mistake (1 frame is a single still).",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene to retime." },
        durationInFrames: { type: "number", description: "New duration in frames. Must be >= 1." },
      },
      required: ["sceneId", "durationInFrames"],
    },
  },
};

export const editDurationImpl = async (rawArgs: any) => {
  const args = rawArgs as EditDurationArgs;
  if (!args.sceneId) throw new Error("edit_duration: sceneId is required.");
  if (typeof args.durationInFrames !== "number" || !Number.isFinite(args.durationInFrames)) {
    throw new Error("edit_duration: durationInFrames must be a finite number.");
  }
  if (args.durationInFrames < 1) {
    throw new Error("edit_duration: durationInFrames must be >= 1.");
  }

  let oldDuration = 0;
  let elementClips: string[] = [];
  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`edit_duration: scene "${args.sceneId}" not found.`);
    oldDuration = scene.durationInFrames;

    // Find any elements whose visible window extends beyond the new
    // duration. These will be clipped by the renderer.
    const limit = args.durationInFrames;
    for (const el of scene.elements) {
      const end = (el.startFrame ?? 0) + (el.durationInFrames ?? 0);
      if (end > limit) {
        elementClips.push(`${el.name} (ends at frame ${end})`);
      }
    }
    scene.durationInFrames = args.durationInFrames;
    return draft;
  });

  return {
    ok: true,
    sceneId: args.sceneId,
    previousDuration: oldDuration,
    newDuration: args.durationInFrames,
    delta: args.durationInFrames - oldDuration,
    warnings: elementClips.length > 0
      ? [
          `The new duration is shorter than ${elementClips.length} element(s) visible window. ` +
            `They will be clipped at the new scene end: ${elementClips.join(", ")}. ` +
            `If that is not what you want, increase the duration or call set_animation_timing to shorten those elements' durationInFrames.`,
        ]
      : [],
  };
};
