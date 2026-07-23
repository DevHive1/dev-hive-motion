import { sceneStore } from "../../../store/compositionStore";

export const reorderScenesDef = {
  type: "function",
  function: {
    name: "reorder_scenes",
    description: "Reorder scenes in the timeline using an array of scene IDs.",
    parameters: {
      type: "object",
      properties: {
        sceneIds: {
          type: "array",
          items: { type: "string" },
          description: "Scene IDs in the desired order",
        },
      },
      required: ["sceneIds"],
    },
  },
};

export async function reorderScenesImpl(args: Record<string, unknown>) {
  const sceneIds = args.sceneIds as string[];
  if (!Array.isArray(sceneIds)) {
    throw new Error("sceneIds must be an array of string IDs");
  }

  await sceneStore.update((draft) => {
    const sceneMap = new Map(draft.scenes.map((s) => [s.id, s]));
    const reordered: typeof draft.scenes = [];

    for (const id of sceneIds) {
      const scene = sceneMap.get(id);
      if (scene) {
        reordered.push(scene);
        sceneMap.delete(id);
      }
    }
    // Append any remaining scenes that weren't specified
    for (const scene of sceneMap.values()) {
      reordered.push(scene);
    }

    draft.scenes = reordered;
    return draft;
  });

  return { success: true, count: sceneIds.length };
}
