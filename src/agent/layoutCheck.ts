export interface LayoutBox {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  startFrame: number;
  opacity: number;
}

/**
 * Runs the same checks whether the boxes came from an already-built scene
 * (review_scene) or a proposed-but-not-yet-built layout (plan_scene_layout)
 * - catching a layering/bounds mistake before anything is built is strictly
 * better than catching it after, so both tools share this exact logic.
 */
export function computeLayoutFlags(elements: LayoutBox[]): string[] {
  const flags: string[] = [];

  const visibleAtStart = elements.some((el) => el.startFrame === 0 && el.opacity > 0);
  if (!visibleAtStart && elements.length > 0) {
    flags.push(
      "No element is visible at frame 0 - the scene may show only its background (or nothing) for several frames before anything appears. If that's not intentional, give at least one element startFrame:0.",
    );
  }

  for (const el of elements) {
    const overRight = el.x + el.width - 100;
    const overBottom = el.y + el.height - 100;
    if (el.x < -20 || el.y < -20 || overRight > 20 || overBottom > 20) {
      flags.push(
        `${el.name} (${el.id}) is significantly outside the canvas (x:${el.x}, y:${el.y}, width:${el.width}, height:${el.height}) - likely unintentional, not a deliberate bleed.`,
      );
    }
  }

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      const overlaps = !(
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      );
      if (!overlaps) continue;

      const [lower, higher] = a.zIndex <= b.zIndex ? [a, b] : [b, a];
      // A shape/image/video/custom stacked ABOVE a text element it
      // overlaps is the classic "background covers the caption" mistake.
      if (
        (higher.type === "shape" || higher.type === "image" || higher.type === "video" || higher.type === "custom") &&
        lower.type === "text"
      ) {
        flags.push(
          `${higher.name} (${higher.id}, zIndex ${higher.zIndex}, type ${higher.type}) overlaps and is stacked ABOVE ${lower.name} (${lower.id}, zIndex ${lower.zIndex}, type text) - it may be covering the text. If the text should be visible, give it a higher zIndex.`,
        );
      }
    }
  }

  return flags;
}
