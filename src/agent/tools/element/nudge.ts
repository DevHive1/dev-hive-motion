/**
 * Atomic single-field tool for nudging an element's position or size by
 * a delta. Solves the "small detail" case the agent's report called out -
 * repeatedly calling update_element to read-then-write just to move
 * something 2px to the right burns through the iteration budget and
 * produces a chat log full of noisy tool calls.
 *
 * Supports: x, y, width, height as deltas. Optional clamp keeps the
 * element on-canvas. Optional aspectRatioLock scales both width and
 * height by the same factor (using the larger of the two so neither
 * dimension goes negative).
 */

import { sceneStore } from "../../../server/sceneStore";

interface NudgeArgs {
  sceneId: string;
  elementId: string;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  clampToCanvas?: boolean;
  aspectRatioLock?: boolean;
}

const CLAMP_MIN = -50; // allow some off-canvas (overflow effects) but not extreme
const CLAMP_MAX = 200;

export const nudgeElementDef = {
  type: "function",
  function: {
    name: "nudge_element",
    description:
      "Move or resize an element by a delta (small adjustment). " +
      "Use this instead of update_element when the change is a relative nudge " +
      "like 'move it 2px to the right' or 'shrink it 5%'. " +
      "dx/dy shift position; dw/dh shift size. " +
      "Set aspectRatioLock:true to keep the width:height ratio when resizing. " +
      "Set clampToCanvas:true (default) to keep the element inside roughly [-50, 200] percent of the canvas.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene containing the element." },
        elementId: { type: "string", description: "The element to nudge." },
        dx: { type: "number", description: "Horizontal shift in percent of canvas width (e.g. 2 = +2% right, -1.5 = 1.5% left). Default 0." },
        dy: { type: "number", description: "Vertical shift in percent of canvas height. Default 0." },
        dw: { type: "number", description: "Width delta in percent. Default 0." },
        dh: { type: "number", description: "Height delta in percent. Default 0." },
        clampToCanvas: { type: "boolean", description: "Keep the resulting element within [-50, 200] of the canvas. Default true." },
        aspectRatioLock: { type: "boolean", description: "Apply the same factor to width and height when resizing. Default false." },
      },
      required: ["sceneId", "elementId"],
    },
  },
};

export const nudgeElementImpl = async (rawArgs: any) => {
  const args = rawArgs as NudgeArgs;
  if (typeof args.sceneId !== "string" || typeof args.elementId !== "string") {
    throw new Error("nudge_element: sceneId and elementId are required.");
  }
  const dx = Number(args.dx ?? 0);
  const dy = Number(args.dy ?? 0);
  const dw = Number(args.dw ?? 0);
  const dh = Number(args.dh ?? 0);
  const clamp = args.clampToCanvas !== false;
  const lock = args.aspectRatioLock === true;

  if (![dx, dy, dw, dh].every((n) => Number.isFinite(n))) {
    throw new Error("nudge_element: dx/dy/dw/dh must all be finite numbers (or omitted).");
  }
  if (dx === 0 && dy === 0 && dw === 0 && dh === 0) {
    return { ok: true, changed: false, note: "All deltas are zero - no change made." };
  }

  let resultPatch: Record<string, number> = {};
  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) {
      throw new Error(`nudge_element: scene "${args.sceneId}" not found. Call list_scenes to see valid ids.`);
    }
    const el = scene.elements.find((e) => e.id === args.elementId);
    if (!el) {
      throw new Error(`nudge_element: element "${args.elementId}" not found in scene "${args.sceneId}".`);
    }

    let newX = (el.x ?? 0) + dx;
    let newY = (el.y ?? 0) + dy;
    let newW = (el.width ?? 0) + dw;
    let newH = (el.height ?? 0) + dh;

    if (lock && (dw !== 0 || dh !== 0)) {
      // Apply the larger absolute change as the shared factor. The other
      // dimension scales by the same factor. This keeps the aspect ratio
      // without going negative.
      const wRef = el.width ?? 1;
      const hRef = el.height ?? 1;
      const wFactor = wRef > 0 ? 1 + dw / wRef : 1;
      const hFactor = hRef > 0 ? 1 + dh / hRef : 1;
      const factor = Math.abs(wFactor - 1) > Math.abs(hFactor - 1) ? wFactor : hFactor;
      newW = wRef * factor;
      newH = hRef * factor;
    }

    if (clamp) {
      newX = Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, newX));
      newY = Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, newY));
      newW = Math.min(CLAMP_MAX, Math.max(1, newW));
      newH = Math.min(CLAMP_MAX, Math.max(1, newH));
    }

    const patch: Record<string, number> = {};
    if (newX !== el.x) patch.x = round(newX);
    if (newY !== el.y) patch.y = round(newY);
    if (newW !== el.width) patch.width = round(newW);
    if (newH !== el.height) patch.height = round(newH);
    Object.assign(el, patch);
    resultPatch = patch;
    return draft;
  });

  return {
    ok: true,
    changed: Object.keys(resultPatch).length > 0,
    applied: resultPatch,
    note:
      Object.keys(resultPatch).length === 0
        ? "Nudge would have moved the element but it was already at a boundary (with clampToCanvas)."
        : clamp
        ? undefined
        : "clampToCanvas was off; result may be partially off-canvas.",
  };
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
