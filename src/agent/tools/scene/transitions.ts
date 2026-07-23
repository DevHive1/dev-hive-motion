import { sceneStore } from "../../../store/compositionStore";
import { TransitionType, TransitionDirection } from "../../../schema/scene";

export const setAllTransitionsDef = {
  type: "function",
  function: {
    name: "set_all_transitions",
    description: "Apply transitions across all scenes in the timeline with a consistent or varied pattern.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["fade", "slide", "wipe", "flip", "clockWipe", "dissolve", "zoom", "push", "reveal"],
        },
        direction: {
          type: "string",
          enum: ["from-left", "from-right", "from-top", "from-bottom"],
        },
        durationInFrames: { type: "number", default: 15 },
      },
      required: ["type"],
    },
  },
};

export async function setAllTransitionsImpl(args: Record<string, unknown>) {
  const transitionType = TransitionType.parse(args.type ?? "fade");
  const direction = TransitionDirection.parse(args.direction ?? "from-right");
  const durationInFrames = Number(args.durationInFrames ?? 15);

  await sceneStore.update((draft) => {
    draft.scenes.forEach((scene, index) => {
      if (index === 0) return; // Skip first scene
      scene.transitionIn = {
        type: transitionType,
        direction,
        durationInFrames,
      };
    });
    return draft;
  });

  return { success: true, type: transitionType, durationInFrames };
}
