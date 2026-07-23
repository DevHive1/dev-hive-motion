import { sceneStore } from "../../../store/compositionStore";

export const editByMentionDef = {
  type: "function",
  function: {
    name: "edit_by_mention",
    description: "Edit or delete an element or scene referenced by name or @mention.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or text content of the element or scene" },
        action: { type: "string", enum: ["edit", "delete"] },
        patch: { type: "object", description: "For 'edit' action — object of fields to overwrite" },
      },
      required: ["query", "action"],
    },
  },
};

export async function editByMentionImpl(args: Record<string, unknown>) {
  const query = (args.query as string).toLowerCase().trim();
  const action = args.action as "edit" | "delete";
  const patch = (args.patch as Record<string, unknown>) || {};

  let matchedElementId: string | null = null;
  let matchedSceneId: string | null = null;

  await sceneStore.update((draft) => {
    for (const scene of draft.scenes) {
      for (let i = 0; i < scene.elements.length; i++) {
        const el = scene.elements[i];
        const textVal = "text" in el ? String(el.text).toLowerCase() : "";
        const nameVal = String(el.name).toLowerCase();
        const idVal = String(el.id).toLowerCase();

        if (nameVal.includes(query) || textVal.includes(query) || idVal === query) {
          matchedElementId = el.id;
          matchedSceneId = scene.id;

          if (action === "delete") {
            scene.elements.splice(i, 1);
          } else if (action === "edit") {
            scene.elements[i] = { ...el, ...patch } as typeof el;
          }
          return draft;
        }
      }
    }
    return draft;
  });

  if (!matchedElementId) {
    return { success: false, error: `No element found matching "${query}"` };
  }

  return { success: true, action, elementId: matchedElementId, sceneId: matchedSceneId };
}
