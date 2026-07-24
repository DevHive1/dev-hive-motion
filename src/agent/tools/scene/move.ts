import { sceneStore } from "../../../store/compositionStore";

export const moveSceneDef = {
  type: "function",
  function: {
    name: "move_scene",
    description:
      "Move a scene to a new position in the timeline (e.g. move scene 5 to position 1, move scene X after scene Y, or shift scene up/down).",
    parameters: {
      type: "object",
      properties: {
        sceneId: {
          type: "string",
          description: "ID of the scene to move, or 1-indexed scene number as a string (e.g. '3').",
        },
        toPosition: {
          type: "number",
          description: "1-indexed target position in the timeline (1 = first scene, 2 = second scene, etc.).",
        },
        afterSceneId: {
          type: "string",
          description: "ID of the scene to place this scene after.",
        },
        beforeSceneId: {
          type: "string",
          description: "ID of the scene to place this scene before.",
        },
        direction: {
          type: "string",
          enum: ["first", "last", "up", "down"],
          description: "Quick position movement: 'first' (front), 'last' (end), 'up' (1 step earlier), 'down' (1 step later).",
        },
      },
      required: ["sceneId"],
    },
  },
};

export async function moveSceneImpl(args: {
  sceneId: string;
  toPosition?: number;
  afterSceneId?: string;
  beforeSceneId?: string;
  direction?: "first" | "last" | "up" | "down";
}) {
  let resultIndex = -1;

  await sceneStore.update((draft) => {
    const scenes = draft.scenes;
    let fromIdx = scenes.findIndex((s) => s.id === args.sceneId);

    // If not found by exact ID, try parsing sceneId as 1-indexed number
    if (fromIdx === -1 && !isNaN(Number(args.sceneId))) {
      const idx = Number(args.sceneId) - 1;
      if (idx >= 0 && idx < scenes.length) {
        fromIdx = idx;
      }
    }

    if (fromIdx === -1) {
      throw new Error(`Scene not found for "${args.sceneId}". Call list_scenes to view valid scenes.`);
    }

    const [targetScene] = scenes.splice(fromIdx, 1);
    let newIdx = fromIdx;

    if (args.toPosition !== undefined) {
      newIdx = Math.max(0, Math.min(scenes.length, args.toPosition - 1));
    } else if (args.afterSceneId) {
      const afterIdx = scenes.findIndex((s) => s.id === args.afterSceneId);
      newIdx = afterIdx !== -1 ? afterIdx + 1 : scenes.length;
    } else if (args.beforeSceneId) {
      const beforeIdx = scenes.findIndex((s) => s.id === args.beforeSceneId);
      newIdx = beforeIdx !== -1 ? beforeIdx : 0;
    } else if (args.direction === "first") {
      newIdx = 0;
    } else if (args.direction === "last") {
      newIdx = scenes.length;
    } else if (args.direction === "up") {
      newIdx = Math.max(0, fromIdx - 1);
    } else if (args.direction === "down") {
      newIdx = Math.min(scenes.length, fromIdx + 1);
    }

    scenes.splice(newIdx, 0, targetScene);
    resultIndex = newIdx + 1;
    return draft;
  });

  return { success: true, sceneId: args.sceneId, newPosition: resultIndex };
}
