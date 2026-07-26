/**
 * remove_animation - delete one animation from an element.
 *
 * Why this exists: an agent that mistakes an animation's id gets
 * stuck - the only path to recovery was update_element with the full
 * animations array rebuilt minus the offending entry, which is
 * awkward (the agent has to read the array first then write back).
 * This tool takes an animationId (from a previous add_animation /
 * add_in_out_animation result) and removes exactly that one.
 */

import { sceneStore } from "../../../server/sceneStore";

interface RemoveAnimationArgs {
  sceneId: string;
  elementId: string;
  /** Id of the animation to remove. Get it from add_animation's result or get_scene's element.animations. */
  animationId: string;
}

export const removeAnimationDef = {
  type: "function",
  function: {
    name: "remove_animation",
    description:
      "Delete a single animation by id. Use when an animation is wrong, redundant, or conflicting (two animations on the same property at the same time). " +
      "Get the animationId from a previous add_animation / add_in_out_animation result, or from get_scene's element.animations array. " +
      "If you want to delete ALL animations on an element and start fresh, pass removeAll:true instead of animationId.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        elementId: { type: "string" },
        animationId: { type: "string", description: "Id of the animation to remove." },
        removeAll: { type: "boolean", description: "If true, remove every animation on the element. Default false." },
      },
      required: ["sceneId", "elementId"],
    },
  },
};

export const removeAnimationImpl = async (rawArgs: any) => {
  const args = rawArgs as RemoveAnimationArgs & { removeAll?: boolean };
  if (!args.sceneId) throw new Error("remove_animation: sceneId is required.");
  if (!args.elementId) throw new Error("remove_animation: elementId is required.");
  if (!args.animationId && !args.removeAll) {
    throw new Error("remove_animation: pass animationId or removeAll:true.");
  }

  let removedId: string | null = null;
  let removedCount = 0;

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`remove_animation: scene "${args.sceneId}" not found.`);
    const el = scene.elements.find((e) => e.id === args.elementId);
    if (!el) {
      const known = scene.elements.map((e) => `${e.id} ("${e.name}")`).join(", ");
      throw new Error(
        `remove_animation: element "${args.elementId}" not found. Available: ${known || "(none)"}.`,
      );
    }
    const before = el.animations.length;
    if (args.removeAll) {
      el.animations = [];
    } else {
      const idx = el.animations.findIndex((a) => a.id === args.animationId);
      if (idx === -1) {
        throw new Error(
          `remove_animation: animation "${args.animationId}" not found on element "${args.elementId}". ` +
            `Existing animation ids: ${el.animations.map((a) => `"${a.id}"`).join(", ") || "(none)"}.`,
        );
      }
      removedId = el.animations[idx].id;
      el.animations.splice(idx, 1);
    }
    removedCount = before - el.animations.length;
    return draft;
  });

  return {
    ok: true,
    sceneId: args.sceneId,
    elementId: args.elementId,
    removedAnimationId: removedId,
    removedCount,
    removeAll: Boolean(args.removeAll),
  };
};
