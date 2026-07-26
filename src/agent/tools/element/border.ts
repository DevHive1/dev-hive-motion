/**
 * add_border - add a 4-edge frame element to a scene. The agent used
 * to fake this with a stretched rectangle, which produced a fill, not
 * a frame. add_border draws a real CSS border on all four sides.
 *
 * Common uses: an outer frame for a "card" look, a vintage film
 * border, a delicate accent border around a stat callout, a
 * "spotlight" frame around a hero image.
 *
 * Borders can sit inset (inside the canvas) with a small margin, or
 * full-bleed. Use boxShadow for an outer glow. Borders animate like
 * any other element (opacity fade for the "frame appears" reveal,
 * scale 1.0->1.05 for a pulse, etc.).
 */

import { nanoid } from "nanoid";
import { sceneStore } from "../../../server/sceneStore";
import type { ShapeElement } from "../../../schema/scene";

interface AddBorderArgs {
  sceneId: string;
  /** Hex color for the frame. Default "#ffffff". */
  color?: string;
  /** Frame thickness in pixels. Default 2 (hairline). Use 4-8 for accent. */
  strokeWidth?: number;
  /** Inset from the canvas edge, as percent of canvas. Default 4. */
  inset?: number;
  /** Corner radius in percent (of the element box). Default 0. */
  borderRadius?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  startFrame?: number;
  durationInFrames?: number;
  name?: string;
  /** CSS box-shadow for an outer glow or drop shadow. */
  boxShadow?: string;
  /** Optional inner border color. When set, draws a second border just inside the first. */
  innerColor?: string;
  innerStrokeWidth?: number;
}

export const addBorderDef = {
  type: "function",
  function: {
    name: "add_border",
    description:
      "Add a 4-edge frame to a scene - a 'card' or 'spotlight' look. Unlike add_shape_element with shape:'rectangle' (which produces a filled box, not a frame), add_border draws a real border on all four sides of the element's box, optionally inset from the canvas edge, with an optional second inner border for a 'double frame' look. " +
      "Use for: outer frame around the whole scene (vintage film, elegant card), a 'spotlight' frame around a hero image, a delicate accent around a stat callout, a quote box border. " +
      "Common strokeWidths: 1-2px (hairline), 3-6px (accent), 8-16px (bold). The element's boxShadow is used for an outer glow. " +
      "Animate the entrance the same way you would any element (opacity 0->1 for 'frame appears', scale 1.05->1.0 for a subtle settle).",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        color: { type: "string", description: "Frame color. Default '#ffffff'." },
        strokeWidth: { type: "number", description: "Frame thickness in pixels. Default 2." },
        inset: { type: "number", description: "Inset from canvas edge as percent (0-20). Default 4. Set to 0 for full-bleed." },
        borderRadius: { type: "number", description: "Corner radius in percent of the box. Default 0 (sharp corners)." },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", description: "Default 100 - inset*2 (so it spans the canvas minus the inset on each side)." },
        height: { type: "number" },
        zIndex: { type: "number" },
        startFrame: { type: "number" },
        durationInFrames: { type: "number" },
        name: { type: "string" },
        boxShadow: { type: "string" },
        innerColor: { type: "string", description: "If set, draws a second border just inside the first." },
        innerStrokeWidth: { type: "number", description: "Width of the inner border, in pixels. Default 1." },
      },
      required: ["sceneId"],
    },
  },
};

export const addBorderImpl = async (rawArgs: any) => {
  const args = rawArgs as AddBorderArgs;
  if (!args.sceneId) throw new Error("add_border: sceneId is required.");
  const inset = args.inset ?? 4;
  if (inset < 0 || inset > 20) {
    throw new Error("add_border: inset must be between 0 and 20 (percent of canvas).");
  }
  if (args.strokeWidth !== undefined && args.strokeWidth <= 0) {
    throw new Error("add_border: strokeWidth must be > 0.");
  }

  const x = args.x ?? inset;
  const y = args.y ?? inset;
  const width = args.width ?? 100 - inset * 2;
  const height = args.height ?? 100 - inset * 2;

  // If an inner border is requested, we add a SECOND element. The agent
  // gets two elementIds back so it can animate them together or apart.
  const ids: string[] = [];

  const outer: ShapeElement = {
    id: `el-${nanoid(6)}`,
    type: "shape",
    name: args.name ?? "Border",
    shape: "border",
    fill: args.color ?? "#ffffff",
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex: args.zIndex ?? 0,
    startFrame: args.startFrame ?? 0,
    durationInFrames: args.durationInFrames ?? 150,
    animations: [],
    locked: false,
    hidden: false,
    strokeColor: args.color ?? "#ffffff",
    strokeWidth: args.strokeWidth ?? 2,
    borderRadius: args.borderRadius ?? 0,
    boxShadow: args.boxShadow,
    blurPx: 0,
    backdropBlurPx: 0,
  };
  ids.push(outer.id);

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`add_border: scene "${args.sceneId}" not found.`);
    scene.elements.push(outer);
    if (args.innerColor) {
      const innerInset = 1.2; // 1.2% of canvas between outer and inner
      const inner: ShapeElement = {
        id: `el-${nanoid(6)}`,
        type: "shape",
        name: (args.name ?? "Border") + " (inner)",
        shape: "border",
        fill: args.innerColor,
        x: x + innerInset,
        y: y + innerInset,
        width: width - innerInset * 2,
        height: height - innerInset * 2,
        rotation: 0,
        opacity: 1,
        zIndex: args.zIndex ?? 0,
        startFrame: args.startFrame ?? 0,
        durationInFrames: args.durationInFrames ?? 150,
        animations: [],
        locked: false,
        hidden: false,
        strokeColor: args.innerColor,
        strokeWidth: args.innerStrokeWidth ?? 1,
        borderRadius: Math.max(0, (args.borderRadius ?? 0) - 1),
        blurPx: 0,
        backdropBlurPx: 0,
      };
      ids.push(inner.id);
      scene.elements.push(inner);
    }
    return draft;
  });

  return {
    sceneId: args.sceneId,
    elementIds: ids,
    startFrame: outer.startFrame,
    durationInFrames: outer.durationInFrames,
    strokeWidth: args.strokeWidth ?? 2,
    hasInner: Boolean(args.innerColor),
  };
};
