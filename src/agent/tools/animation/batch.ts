import { sceneStore } from "../../../store/compositionStore";
import { generateId } from "../../../core/utils/id";

export const animateSceneDef = {
  type: "function",
  function: {
    name: "animate_scene",
    description: "Batch apply entrance animations to all non-background elements in a scene with staggered timing.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        style: {
          type: "string",
          enum: ["fade_up", "fade_in", "slide_left", "slide_right", "scale_in"],
          default: "fade_up",
        },
        staggerFrames: { type: "number", default: 5 },
        durationInFrames: { type: "number", default: 18 },
      },
      required: ["sceneId"],
    },
  },
};

export async function animateSceneImpl(args: Record<string, unknown>) {
  const sceneId = args.sceneId as string;
  const style = (args.style as string) || "fade_up";
  const stagger = Number(args.staggerFrames ?? 5);
  const duration = Number(args.durationInFrames ?? 18);

  let animatedCount = 0;

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`Scene not found: ${sceneId}`);

    // Exclude background elements (zIndex <= 0 or full bleed shapes/images)
    const contentElements = scene.elements.filter(
      (el) => !(el.x === 0 && el.y === 0 && el.width === 100 && el.height === 100 && el.zIndex === 0),
    );

    contentElements.forEach((el, index) => {
      const startFrame = index * stagger;
      el.animations = el.animations || [];

      if (style === "fade_up") {
        el.animations.push(
          {
            id: generateId("anim"),
            property: "opacity",
            from: 0,
            to: 1,
            startFrame,
            durationInFrames: duration,
            easing: "easeOut",
          },
          {
            id: generateId("anim"),
            property: "y",
            from: 4,
            to: 0,
            startFrame,
            durationInFrames: duration,
            easing: "easeOut",
          },
        );
      } else if (style === "fade_in") {
        el.animations.push({
          id: generateId("anim"),
          property: "opacity",
          from: 0,
          to: 1,
          startFrame,
          durationInFrames: duration,
          easing: "easeOut",
        });
      } else if (style === "scale_in") {
        el.animations.push(
          {
            id: generateId("anim"),
            property: "opacity",
            from: 0,
            to: 1,
            startFrame,
            durationInFrames: duration,
            easing: "easeOut",
          },
          {
            id: generateId("anim"),
            property: "scale",
            from: 0.8,
            to: 1,
            startFrame,
            durationInFrames: duration,
            easing: "easeOut",
          },
        );
      }
      animatedCount++;
    });

    return draft;
  });

  return { success: true, sceneId, animatedCount, style };
}
