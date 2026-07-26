import { nanoid } from "nanoid";
import { sceneStore } from "../../../server/sceneStore";
import { validateElementPatch } from "./validatePatch";
import type { SceneElement } from "../../../schema/scene";

/**
 * duplicate_element — the agent's #1 ask (error.txt item 4).
 *
 * Clone a single element (glass panel, card, badge) with optional
 * overrides instead of rewriting all 9 properties from scratch. Copies
 * position, size, style, and animations; only the fields you pass get
 * overridden.
 *
 * Use cases the agent hit:
 *   - Same glass panel, new heading text in 5 scenes
 *   - Same icon style, different color/position in 3 scenes
 *   - Same badge layout, but offset down a few percent
 */
export const duplicateElementDef = {
  type: "function",
  function: {
    name: "duplicate_element",
    description:
      "Clone an existing element as a starting point for a new one in the same scene. Copies position, size, style, and animations; pass any of text/name/x/y/xOffset/yOffset/width/height/zIndex/ to override. Use this to reuse a glass panel, card, badge, or icon style across multiple elements/scenes without rebuilding the same 9 properties each time - much more reliable than re-typing the style. The clone gets a new elementId, sits next to the original by default (or at the offset you give), and animates in at the same startFrame as the original.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene containing the element to clone." },
        elementId: { type: "string", description: "The element to clone." },
        text: { type: "string", description: "Override the new element's text (only meaningful for text/custom elements). For custom elements, this replaces the html." },
        name: { type: "string", description: "Override the new element's display name." },
        x: { type: "number", description: "Override x (percent of canvas). Defaults to the original's x." },
        y: { type: "number", description: "Override y (percent of canvas). Defaults to the original's y." },
        xOffset: { type: "number", description: "Shift the new element horizontally by this many percent (e.g. 5 = 5% to the right of the original). Added on top of x if both are passed." },
        yOffset: { type: "number", description: "Shift the new element vertically by this percent. Added on top of y if both are passed." },
        width: { type: "number", description: "Override width (percent of canvas)." },
        height: { type: "number", description: "Override height (percent of canvas)." },
        zIndex: { type: "number", description: "Override zIndex. Defaults to one above the original so the clone sits in front." },
        copyAnimations: { type: "boolean", description: "Whether to copy the original's animations onto the clone. Defaults to true. Set false for a static clone." },
      },
      required: ["sceneId", "elementId"],
    },
  },
};

type DuplicateArgs = {
  sceneId: string;
  elementId: string;
  text?: string;
  name?: string;
  x?: number;
  y?: number;
  xOffset?: number;
  yOffset?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  copyAnimations?: boolean;
};

export async function duplicateElementImpl(args: DuplicateArgs) {
  let newElementId = "";
  let source: SceneElement | undefined;

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`No scene with id "${args.sceneId}". Call list_scenes to see valid ids.`);

    const original = scene.elements.find((e) => e.id === args.elementId);
    if (!original) {
      throw new Error(
        `No element with id "${args.elementId}" in scene "${args.sceneId}". Call list_scenes to see valid ids.`,
      );
    }
    source = original;

    const copyAnimations = args.copyAnimations !== false; // default true

    // Deep-clone via structuredClone so nested objects/animations arrays are
    // independent of the source - editing the clone's animations must NOT
    // mutate the original.
    const cloned = structuredClone(original) as SceneElement;
    cloned.id = `el-${nanoid(6)}`;
    cloned.name = args.name ?? `${original.name} copy`;

    // Type-specific text override: text elements get .text replaced, custom
    // elements get .html replaced. Other element types ignore `text` since
    // they have no string body.
    if (args.text !== undefined) {
      if (cloned.type === "text") {
        (cloned as { text: string }).text = args.text;
        // Update the display name to reflect the new text so it's easy to
        // find in the element list later.
        cloned.name = args.name ?? args.text.slice(0, 24);
      } else if (cloned.type === "custom") {
        (cloned as { html: string }).html = args.text;
      } else {
        // Image/video/shape/audio: text override is meaningless, but we
        // don't want to silently swallow it. Surface as a warning, not an
        // error - the rest of the duplication still happens.
      }
    }

    if (typeof args.x === "number") cloned.x = args.x;
    if (typeof args.y === "number") cloned.y = args.y;
    if (typeof args.width === "number") cloned.width = args.width;
    if (typeof args.height === "number") cloned.height = args.height;
    if (typeof args.zIndex === "number") {
      cloned.zIndex = args.zIndex;
    } else {
      cloned.zIndex = original.zIndex + 1;
    }
    if (typeof args.xOffset === "number" && "x" in cloned) {
      cloned.x = (cloned.x ?? 0) + args.xOffset;
    }
    if (typeof args.yOffset === "number" && "y" in cloned) {
      cloned.y = (cloned.y ?? 0) + args.yOffset;
    }

    if (!copyAnimations) {
      cloned.animations = [];
    } else {
      // Re-id the animation entries so editing one clone's animation
      // never mutates the source's animation by shared reference.
      cloned.animations = cloned.animations.map((anim) => ({
        ...anim,
        id: `anim-${nanoid(6)}`,
      }));
    }

    // Final validation pass - same discipline as update_element. Catches
    // any nonsense the agent passed in the override fields (negative width,
    // opacity out of range, etc) with a clear error.
    validateElementPatch(args.sceneId, args.elementId, cloned);

    scene.elements.push(cloned);
    newElementId = cloned.id;
    return draft;
  });

  return {
    success: true,
    newElementId,
    sourceElementId: args.elementId,
    sceneId: args.sceneId,
    sourceType: source?.type,
    ...(args.text !== undefined && source?.type !== "text" && source?.type !== "custom"
      ? {
          warning: `text override was ignored: source element is type "${source?.type}", which has no text/html body to replace.`,
        }
      : {}),
  };
}
