/**
 * add_line - add a true line element (not a stretched rectangle) to a
 * scene. The agent used to fake lines by calling add_shape_element
 * with shape:"rectangle" and a tiny height - that produces a "line"
 * with full fill, no glow, and broken boxShadow. add_line gives a
 * proper line that:
 *   - has a controlled thickness (the smaller of width/height)
 *   - inherits all of shape's animation/blur/shadow capability
 *   - is orientation-aware (horizontal vs vertical)
 *   - doesn't waste pixels rendering a full background
 *
 * Common uses: a hairline divider under a headline, an accent rule
 * above a stat number, a vertical separator between two columns.
 */

import { nanoid } from "nanoid";
import { sceneStore } from "../../../server/sceneStore";
import type { ShapeElement } from "../../../schema/scene";

interface AddLineArgs {
  sceneId: string;
  /** Hex color, e.g. "#ffffff". */
  color?: string;
  /** Length of the line, as a percent of canvas width. */
  length?: number;
  /** Thickness in pixels. Default 2 (a hairline). Use 4-8 for accent rules. */
  thicknessPx?: number;
  /** "horizontal" (default) or "vertical". */
  orientation?: "horizontal" | "vertical";
  /** Position. Either explicit (x, y) or relative to an existing role. */
  x?: number;
  y?: number;
  relativeTo?: string;
  relation?: "below" | "above" | "leftOf" | "rightOf" | "sameSpot";
  gap?: number;
  /** zIndex. Default 1 (in front of background, behind text). */
  zIndex?: number;
  startFrame?: number;
  durationInFrames?: number;
  name?: string;
  /** Optional CSS box-shadow, e.g. "0 0 12px rgba(255,176,32,0.6)" for a glow. */
  boxShadow?: string;
}

export const addLineDef = {
  type: "function",
  function: {
    name: "add_line",
    description:
      "Add a true line element to a scene. Unlike add_shape_element with a tiny height (which fakes a line with a filled background), add_line draws a real stroke with controlled thickness, glow support via boxShadow, and orientation awareness. " +
      "Use for hairlines under headlines, accent rules above stat numbers, vertical separators between columns, and decorative dividers. " +
      "If the line should sit right below a heading, pass relativeTo:'heading' and relation:'below' instead of computing x/y yourself. " +
      "Common thicknesses: 1-2px (hairline), 3-5px (accent), 6-12px (bold rule).",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        color: { type: "string", description: "Hex color for the line. Default '#ffffff'." },
        length: { type: "number", description: "Line length as percent of canvas (1-100). Default 60 for horizontal, 4 for vertical." },
        thicknessPx: { type: "number", description: "Line thickness in pixels (not percent). Default 2. Use 3-5 for accent rules, 6-12 for bold rules." },
        orientation: { type: "string", enum: ["horizontal", "vertical"], description: "Default 'horizontal'." },
        x: { type: "number" },
        y: { type: "number" },
        relativeTo: { type: "string" },
        relation: { type: "string", enum: ["below", "above", "leftOf", "rightOf", "sameSpot"] },
        gap: { type: "number" },
        zIndex: { type: "number" },
        startFrame: { type: "number" },
        durationInFrames: { type: "number" },
        name: { type: "string" },
        boxShadow: { type: "string", description: "CSS box-shadow for a glow effect, e.g. '0 0 12px rgba(255,176,32,0.6)'." },
      },
      required: ["sceneId"],
    },
  },
};

export const addLineImpl = async (rawArgs: any) => {
  const args = rawArgs as AddLineArgs;
  if (!args.sceneId) throw new Error("add_line: sceneId is required.");
  if (args.thicknessPx !== undefined && args.thicknessPx <= 0) {
    throw new Error("add_line: thicknessPx must be > 0.");
  }
  if (args.length !== undefined && (args.length <= 0 || args.length > 100)) {
    throw new Error("add_line: length must be between 0 and 100 (percent of canvas).");
  }

  const orientation = args.orientation ?? "horizontal";
  // The element's width/height box matches its orientation:
  // horizontal line -> wide box, thin height (line "thickness axis" in % of canvas)
  // vertical line -> thin width, tall height.
  // The actual pixel thickness is then drawn precisely inside via the renderer.
  // We use a small percentage for the thickness axis (0.1-0.5) so the box
  // doesn't have a noticeable footprint.
  const thicknessPct = orientation === "horizontal"
    ? Math.min(0.5, Math.max(0.05, (args.thicknessPx ?? 2) / 100))  // rough px-to-pct for the box
    : Math.min(0.5, Math.max(0.05, (args.thicknessPx ?? 2) / 100));
  const lengthPct = args.length ?? (orientation === "horizontal" ? 60 : 4);

  let x = args.x;
  let y = args.y;
  if (x === undefined) x = (100 - (orientation === "horizontal" ? lengthPct : thicknessPct)) / 2;
  if (y === undefined) y = (100 - (orientation === "horizontal" ? thicknessPct : lengthPct)) / 2;

  // Resolve relative positioning if given.
  if (args.relativeTo) {
    const before = { x, y, width: orientation === "horizontal" ? lengthPct : thicknessPct, height: orientation === "horizontal" ? thicknessPct : lengthPct };
    await sceneStore.update((draft) => {
      const scene = draft.scenes.find((s) => s.id === args.sceneId);
      if (!scene) throw new Error(`add_line: scene "${args.sceneId}" not found.`);
      const ref = scene.elements.find((e) => e.name === args.relativeTo);
      if (!ref) {
        throw new Error(
          `add_line: relativeTo "${args.relativeTo}" not found in scene "${args.sceneId}". ` +
            `Available elements: ${scene.elements.map((e) => e.name).join(", ") || "(none)"}.`,
        );
      }
      const gap = args.gap ?? 1;
      switch (args.relation ?? "below") {
        case "below":
          x = ref.x;
          y = ref.y + ref.height + gap;
          break;
        case "above":
          y = ref.y - before.height - gap;
          break;
        case "leftOf":
          x = ref.x - before.width - gap;
          y = ref.y;
          break;
        case "rightOf":
          x = ref.x + ref.width + gap;
          y = ref.y;
          break;
        case "sameSpot":
          x = ref.x;
          y = ref.y;
          break;
      }
      // We don't actually mutate the store here - we just resolve position.
      return draft;
    });
  }

  // Get scene to compute zIndex and duration
  let nextZ: number;
  let scene: any;
  await sceneStore.update((draft) => {
    scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`add_line: scene "${args.sceneId}" not found.`);
    nextZ = scene.elements.length ? Math.max(...scene.elements.map(e => e.zIndex)) + 1 : 0;
    return draft;
  });

  const element: ShapeElement = {
    id: `el-${nanoid(6)}`,
    type: "shape",
    name: args.name ?? "Line",
    shape: "line",
    fill: args.color ?? "#ffffff",
    x,
    y,
    width: orientation === "horizontal" ? lengthPct : thicknessPct,
    height: orientation === "horizontal" ? thicknessPct : lengthPct,
    rotation: 0,
    opacity: 1,
    zIndex: args.zIndex !== undefined ? args.zIndex : nextZ,
    startFrame: args.startFrame ?? 0,
    durationInFrames: args.durationInFrames ?? Math.max(1, scene.durationInFrames - (args.startFrame ?? 0)),
    animations: [],
    locked: false,
    hidden: false,
    strokeColor: undefined,
    strokeWidth: 0,
    boxShadow: args.boxShadow,
    borderRadius: 0,
    blurPx: 0,
    backdropBlurPx: 0,
  };

  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`add_line: scene "${args.sceneId}" not found.`);
    scene.elements.push(element);
    return draft;
  });

  return {
    elementId: element.id,
    sceneId: args.sceneId,
    startFrame: element.startFrame,
    durationInFrames: element.durationInFrames,
    orientation,
    thicknessPx: args.thicknessPx ?? 2,
  };
};
