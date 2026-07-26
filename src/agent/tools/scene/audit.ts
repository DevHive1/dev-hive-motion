/**
 * audit_scene - logical / compositional analysis of one scene.
 *
 * Why this exists: review_scene catches polish gaps (text-only, no motion,
 * missing transitions, hero timing) and diagnose_scene catches timing
 * budgets (elements clipped past scene end). Neither validates LOGICAL /
 * COMPOSITIONAL correctness — the kind of thing a designer notices
 * about the relative positioning of elements: "is the button text
 * centered on the button?", "is the card wider than it needs to be
 * for its text?", "are these two shapes stacked without reason?",
 * "is there text on top of a shape with a lower zIndex?".
 *
 * audit_scene answers those questions with explicit, structured
 * reports and concrete fix suggestions. Each issue carries a `fix`
 * block with the exact update_element patch the agent can apply
 * directly. Severity is on three levels: error (visibly broken),
 * warning (probably wrong), info (worth knowing).
 */

import { sceneStore } from "../../../server/sceneStore";

interface AuditSceneArgs {
  sceneId: string;
  /** If true, also report info-level observations (not just errors/warnings). Default false. */
  includeInfo?: boolean;
}

interface AuditElement {
  id: string;
  name?: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  textAlign?: string;
  fontSize?: number;
}

interface AuditIssue {
  severity: "error" | "warning" | "info";
  category:
    | "text-off-shape"
    | "text-outside-shape"
    | "overlapping-siblings"
    | "stacked-text-without-relation"
    | "parent-narrower-than-child"
    | "inconsistent-spacing"
    | "back-shape-over-text"
    | "out-of-canvas-margin"
    | "isolated-text"
    | "name-collision";
  message: string;
  /** Element ids the issue concerns. */
  elementIds: string[];
  fix?: {
    tool: string;
    reason: string;
    suggestedArgs: Record<string, unknown>;
  };
}

interface AuditSceneResult {
  ok: true;
  sceneId: string;
  sceneName: string;
  elementCount: number;
  /** Per-element audit summary (counts of overlapping siblings, parent/child mismatches, etc.). */
  elements: Array<{
    id: string;
    name?: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    flags: string[];
  }>;
  issues: AuditIssue[];
  /** Quick stat - how many in each severity. */
  severityCounts: { errors: number; warnings: number; info: number };
  headline: string;
  /** Recommended next tool call. */
  recommendedAction: string;
}

interface RawElement {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  textAlign?: string;
  fontSize?: number;
  startFrame?: number;
  hidden?: boolean;
}

export const auditSceneDef = {
  type: "function",
  function: {
    name: "audit_scene",
    description:
      "Run a root-cause logical/compositional analysis on one scene and report visual-element placement issues the polish + timing checks miss. " +
      "Use this when the user reports 'the text isn't on the button', 'the cards are stacked weirdly', 'something looks off-centre', 'why is the background over the text?', or any visual problem where the obvious fixes (edit_element / update_element / rearrange z-order) didn't fix it. " +
      "audit_scene checks: text alignment over shapes (button text not centred), text overflowing its parent shape, overlapping siblings, parent narrower than child, stacked text without grouping, inconsistent spacing within a row, z-order inverted (background shape above foreground text), elements too close to the canvas edge, isolated text elements, and name-collision. " +
      "Returns a structured report with severity-tagged issues, suggested update_element patches, and a one-sentence headline you can quote back to the user.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene to audit. Get it from list_scenes." },
        includeInfo: { type: "boolean", description: "Also report info-level observations. Default false." },
      },
      required: ["sceneId"],
    },
  },
};

const TEXT_TYPES = new Set(["text"]);
const SHAPE_TYPES = new Set(["shape", "image", "video", "custom"]);

/** Tolerance for "is this aligned" - 0.5 percentage points. */
const ALIGN_TOLERANCE = 0.5;
/** Tolerance for "is this within the shape" - 1.5 percentage points. */
const CONTAIN_TOLERANCE = 1.5;
/** Tolerance for spacing consistency within a group. */
const SPACING_TOLERANCE = 1.5;

function rectOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return w * h;
}

function rectContains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }, tol: number): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
}

function center(r: { x: number; y: number; width: number; height: number }): { cx: number; cy: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

function rectCenterAlignsTo(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, tol: number): { hMatch: boolean; vMatch: boolean } {
  const ca = center(a);
  const cb = center(b);
  return {
    hMatch: Math.abs(ca.cx - cb.cx) <= tol,
    vMatch: Math.abs(ca.cy - cb.cy) <= tol,
  };
}

export const auditSceneImpl = async (rawArgs: unknown): Promise<AuditSceneResult> => {
  const args = rawArgs as AuditSceneArgs;
  if (!args.sceneId) throw new Error("audit_scene: sceneId is required.");
  const includeInfo = Boolean(args.includeInfo);

  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === args.sceneId);
  if (!scene) {
    const known = composition.scenes.map((s) => s.id).join(", ");
    throw new Error(
      `audit_scene: scene "${args.sceneId}" not found. Existing scene ids: ${known || "(none)"}`,
    );
  }

  const allElements = scene.elements as RawElement[];
  const elements = allElements
    .filter((el) => !el.hidden)
    .map<AuditElement>((el) => ({
      id: el.id,
      name: el.name,
      type: el.type,
      x: el.x ?? 0,
      y: el.y ?? 0,
      width: el.width ?? 0,
      height: el.height ?? 0,
      zIndex: el.zIndex ?? 0,
      textAlign: el.textAlign,
      fontSize: el.fontSize,
    }));

  const issues: AuditIssue[] = [];
  const elementFlags = new Map<string, string[]>();

  const addFlag = (elId: string, flag: string) => {
    if (!elementFlags.has(elId)) elementFlags.set(elId, []);
    elementFlags.get(elId)!.push(flag);
  };

  // ── Detection 1: name collisions (across all elements, hidden or not)
  const nameCounts = new Map<string, RawElement[]>();
  for (const el of allElements) {
    if (!el.name) continue;
    if (!nameCounts.has(el.name)) nameCounts.set(el.name, []);
    nameCounts.get(el.name)!.push(el);
  }
  for (const [name, group] of nameCounts.entries()) {
    if (group.length < 2) continue;
    issues.push({
      severity: "warning",
      category: "name-collision",
      message: `${group.length} elements share the name "${name}" (ids: ${group.map((e) => `"${e.id}"`).join(", ")}). update_element.byName and lookups by name will silently pick the first one - rename via update_element for unambiguous addressing.`,
      elementIds: group.map((e) => e.id),
    });
  }

  // ── Detection 2: text-on-shape (button text)
  // For each text element, look for a shape/image/custom in front of (lower index OK) or behind it
  // that the text is meant to be IN. If text is roughly inside shape bounds but not
  // center-aligned with the shape, flag as text-off-shape.
  for (const text of elements) {
    if (!TEXT_TYPES.has(text.type)) continue;
    let bestContainer: AuditElement | null = null;
    let bestContainment = CONTAIN_TOLERANCE + 1;
    for (const other of elements) {
      if (other.id === text.id) continue;
      if (!SHAPE_TYPES.has(other.type)) continue;
      // Text must be near the shape - within shape's expanded bounds or inside shape.
      const expansionLeft = text.x;
      const expansionTop = text.y;
      const expansionRight = 100 - (text.x + text.width);
      const expansionBottom = 100 - (text.y + text.height);
      const slack = Math.max(expansionLeft, expansionTop, expansionRight, expansionBottom);
      if (rectContains(other, text, slack)) {
        const slackUsed = Math.max(
          Math.max(0, text.x - other.x),
          Math.max(0, text.y - other.y),
          Math.max(0, text.x + text.width - (other.x + other.width)),
          Math.max(0, text.y + text.height - (other.y + other.height)),
        );
        if (slackUsed < bestContainment) {
          bestContainment = slackUsed;
          bestContainer = other;
        }
      }
    }
    if (!bestContainer) continue;
    const shape = bestContainer as AuditElement;
    // Check center alignment
    const align = rectCenterAlignsTo(text, shape, ALIGN_TOLERANCE);
    if (!align.hMatch || !align.vMatch) {
      // The text is inside a shape but not centered on it. Likely a "button" or
      // badge where the user meant the text to sit centered.
      // Compute the centered x/y so the fix can apply it.
      const targetX = +(shape.x + (shape.width - text.width) / 2).toFixed(2);
      const targetY = +(shape.y + (shape.height - text.height) / 2).toFixed(2);
      issues.push({
        severity: "error",
        category: "text-off-shape",
        message:
          `Text "${text.name ?? text.id}" sits inside shape "${shape.name ?? shape.id}" ` +
          `(id "${shape.id}") but is not centre-aligned with it. ` +
          `Text centre: (${(text.x + text.width / 2).toFixed(1)}, ${(text.y + text.height / 2).toFixed(1)}); ` +
          `Shape centre: (${(shape.x + shape.width / 2).toFixed(1)}, ${(shape.y + shape.height / 2).toFixed(1)}). ` +
          `${!align.hMatch ? "Off-centre horizontally" : "Off-centre vertically"}.`,
        elementIds: [text.id, shape.id],
        fix: {
          tool: "update_element",
          reason: "Centre the text on its container shape.",
          suggestedArgs: { sceneId: scene.id, elementId: text.id, patch: { x: targetX, y: targetY } },
        },
      });
      addFlag(text.id, "text-off-shape");
    }
  }

  // ── Detection 3: text outside shape (overflowing)
  for (const text of elements) {
    if (!TEXT_TYPES.has(text.type)) continue;
    // Find shapes whose bounds touch the text's bounds (overlap > 0)
    // and where the text extends beyond the shape's right or bottom edge.
    for (const shape of elements) {
      if (shape.id === text.id) continue;
      if (!SHAPE_TYPES.has(shape.type)) continue;
      const overlap = rectOverlap(text, shape);
      if (overlap <= 0) continue;
      const textRight = text.x + text.width;
      const shapeRight = shape.x + shape.width;
      const textBottom = text.y + text.height;
      const shapeBottom = shape.y + shape.height;
      const overflowRight = textRight - shapeRight;
      const overflowBottom = textBottom - shapeBottom;
      const overflowLeft = shape.x - text.x;
      const overflowTop = shape.y - text.y;
      const overflow = Math.max(overflowRight, overflowBottom, overflowLeft, overflowTop);
      if (overflow <= CONTAIN_TOLERANCE) continue;
      const dir = overflowRight === overflow ? "right" : overflowBottom === overflow ? "bottom" : overflowLeft === overflow ? "left" : "top";
      issues.push({
        severity: overflow > 4 ? "error" : "warning",
        category: "text-outside-shape",
        message:
          `Text "${text.name ?? text.id}" overflows shape "${shape.name ?? shape.id}" by ${overflow.toFixed(2)}% to the ${dir}. ` +
          `Text bounds: (${text.x.toFixed(1)}, ${text.y.toFixed(1)}, ${text.width.toFixed(1)}×${text.height.toFixed(1)}). ` +
          `Shape bounds: (${shape.x.toFixed(1)}, ${shape.y.toFixed(1)}, ${shape.width.toFixed(1)}×${shape.height.toFixed(1)}). ` +
          `Either expand the shape, shrink the text, or move the text inside.`,
        elementIds: [text.id, shape.id],
      });
      addFlag(text.id, "text-outside-shape");
    }
  }

  // ── Detection 4: overlapping siblings (same type, near-identical bounds)
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (a.type !== b.type) continue;
      // Specifically: shape-text pairing is fine. But two shapes with
      // identical bounds likely indicate unintended duplication.
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const dw = Math.abs(a.width - b.width);
      const dh = Math.abs(a.height - b.height);
      if (dx <= ALIGN_TOLERANCE && dy <= ALIGN_TOLERANCE && dw <= ALIGN_TOLERANCE && dh <= ALIGN_TOLERANCE) {
        // Skip if one is the background (full-canvas) of the scene
        if (a.width >= 99 && b.width >= 99) continue;
        if (a.zIndex === b.zIndex) {
          issues.push({
            severity: "warning",
            category: "overlapping-siblings",
            message:
              `Two ${a.type} elements have identical bounds and zIndex. ` +
              `"${a.name ?? a.id}" (id "${a.id}") and "${b.name ?? b.id}" (id "${b.id}") — ` +
              `one will render on top of the other with no visible distinction. ` +
              `Move or remove one, or change the zIndex.`,
            elementIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // ── Detection 5: stacked text without grouping
  // Two or more text elements at the same x-band, close y, no shape between them
  for (let i = 0; i < elements.length; i++) {
    const a = elements[i];
    if (!TEXT_TYPES.has(a.type)) continue;
    const group: AuditElement[] = [a];
    for (let j = i + 1; j < elements.length; j++) {
      const b = elements[j];
      if (!TEXT_TYPES.has(b.type)) continue;
      const aY2 = a.y + a.height;
      const bY1 = b.y;
      // Need to be roughly aligned horizontally (overlap x)
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      if (xOverlap <= 0) continue;
      // Within a small vertical gap (no large space between)
      const yGap = bY1 - aY2;
      if (yGap < 0 || yGap > 5) continue;
      // No shape in between them (gap contains no other element)
      const hasShapeBetween = elements.some((other) => {
        if (other.id === a.id || other.id === b.id) return false;
        if (!SHAPE_TYPES.has(other.type)) return false;
        const inX = other.x >= Math.min(a.x, b.x) - 1 && other.x + other.width <= Math.max(a.x + a.width, b.x + b.width) + 1;
        const inY = other.y + other.height >= a.y + a.height && other.y <= b.y + 0.01;
        return inX && inY;
      });
      if (!hasShapeBetween) {
        group.push(b);
      }
    }
    if (group.length < 2) continue;
    // Only the i'th element should be the seed of one group, deduped.
    if (group[0].id !== a.id) continue;
    const ids = group.map((g) => g.id);
    const warning = group.length === 2;
    issues.push({
      severity: warning ? "warning" : "error",
      category: "stacked-text-without-relation",
      message:
        `${group.length} text elements stacked vertically with no shape grouping them: ` +
        group.map((g) => `"${g.name ?? g.id}" at y=${g.y.toFixed(1)}`).join(", ") +
        `. Either they belong inside a single card/shape container, or they need more vertical spacing.`,
      elementIds: ids,
    });
  }

  // ── Detection 6: parent narrower than child
  // For each shape, see if any text inside it is wider than the shape or
  // taller than the shape (would overflow naturally).
  for (const shape of elements) {
    if (!SHAPE_TYPES.has(shape.type)) continue;
    for (const text of elements) {
      if (!TEXT_TYPES.has(text.type)) continue;
      if (!rectContains(shape, text, -CONTAIN_TOLERANCE)) continue;
      if (text.width > shape.width + CONTAIN_TOLERANCE || text.height > shape.height + CONTAIN_TOLERANCE) {
        // Compute the new shape size that fits the text with breathing room
        const targetWidth = Math.max(shape.width, text.width + 4);
        const targetHeight = Math.max(shape.height, text.height + 4);
        issues.push({
          severity: "warning",
          category: "parent-narrower-than-child",
          message:
            `Shape "${shape.name ?? shape.id}" (${shape.width.toFixed(1)}×${shape.height.toFixed(1)}) ` +
            `is smaller than the text "${text.name ?? text.id}" inside it ` +
            `(${text.width.toFixed(1)}×${text.height.toFixed(1)}). ` +
            `The text will visibly exceed the shape's bounds.`,
          elementIds: [shape.id, text.id],
          fix: {
            tool: "update_element",
            reason: "Resize the parent shape so the child text fits with breathing room.",
            suggestedArgs: {
              sceneId: scene.id,
              elementId: shape.id,
              patch: { width: +targetWidth.toFixed(2), height: +targetHeight.toFixed(2) },
            },
          },
        });
      }
    }
  }

  // ── Detection 7: z-order inverted (shape higher than text on top of it)
  for (const text of elements) {
    if (!TEXT_TYPES.has(text.type)) continue;
    for (const shape of elements) {
      if (shape.id === text.id) continue;
      if (!SHAPE_TYPES.has(shape.type)) continue;
      // Look for text-on-shape (text mostly inside shape bounds)
      if (!rectContains(shape, text, CONTAIN_TOLERANCE)) continue;
      if (shape.zIndex > text.zIndex) {
        // Shape is drawn on top of text inside it. Text will be hidden.
        issues.push({
          severity: "error",
          category: "back-shape-over-text",
          message:
            `Shape "${shape.name ?? shape.id}" has zIndex ${shape.zIndex}, which is HIGHER than ` +
            `text "${text.name ?? text.id}" (zIndex ${text.zIndex}) that is positioned inside it. ` +
            `The shape will draw on top, hiding the text. ` +
            `Reorder_layer with elementId "${text.id}" to bring the text to the front.`,
          elementIds: [text.id, shape.id],
          fix: {
            tool: "reorder_layer",
            reason: "Bring the text on top.",
            suggestedArgs: { sceneId: scene.id, elementId: text.id },
          },
        });
        addFlag(text.id, "back-shape-over-text");
      }
    }
  }

  // ── Detection 8: out-of-canvas margin (within 5% of edge but not bleed)
  // Only flag if x or y is in (0, 5] or [95, 100) or width/height + x/y exceeds 100 by ≤5
  for (const el of elements) {
    const right = el.x + el.width;
    const bottom = el.y + el.height;
    const margin = Math.min(el.x, el.y, 100 - right, 100 - bottom);
    if (margin > 0 && margin < 5) {
      if (includeInfo) {
        issues.push({
          severity: "info",
          category: "out-of-canvas-margin",
          message:
            `"${el.name ?? el.id}" sits ${margin.toFixed(1)}% from a canvas edge. ` +
            `That's safe but visually tight - consider giving it more breathing room.`,
          elementIds: [el.id],
        });
      }
    }
  }

  // ── Detection 9: isolated text (text far from any other element)
  for (const text of elements) {
    if (!TEXT_TYPES.has(text.type)) continue;
    let minDistanceToAnyOther = Infinity;
    for (const other of elements) {
      if (other.id === text.id) continue;
      // Minimum distance between rects (0 if overlapping)
      const dx = Math.max(0, Math.max(text.x - (other.x + other.width), other.x - (text.x + text.width)));
      const dy = Math.max(0, Math.max(text.y - (other.y + other.height), other.y - (text.y + text.height)));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDistanceToAnyOther) minDistanceToAnyOther = d;
    }
    if (minDistanceToAnyOther > 25) {
      if (includeInfo) {
        issues.push({
          severity: "info",
          category: "isolated-text",
          message:
            `"${text.name ?? text.id}" is more than 25% away from any other element. ` +
            `Likely fine if it's a hero title, but check it's not orphaned.`,
          elementIds: [text.id],
        });
      }
    }
  }

  // ── Detection 10: inconsistent spacing within a row
  // Group elements by y-band (overlapping y range). For 3+ elements at similar y,
  // check the gaps between consecutive x positions.
  const yBands: Array<{ y: number; elements: AuditElement[] }> = [];
  for (const a of elements) {
    let band = yBands.find((b) => {
      const overlap = Math.min(a.y + a.height, b.y + (b.elements[0]?.height ?? 0)) - Math.max(a.y, b.y);
      const minHeight = Math.min(a.height, b.elements[0]?.height ?? 0);
      return minHeight > 0 && overlap / minHeight > 0.5;
    });
    if (!band) {
      band = { y: a.y, elements: [] };
      yBands.push(band);
    }
    band.elements.push(a);
  }
  for (const band of yBands) {
    if (band.elements.length < 3) continue;
    const sorted = [...band.elements].sort((a, b) => a.x - b.x);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < 2) continue;
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const spread = Math.max(...gaps) - Math.min(...gaps);
    if (spread > SPACING_TOLERANCE && mean > 1) {
      // Some gaps are noticeably different from others
      const odd = gaps.findIndex((g) => Math.abs(g - mean) > SPACING_TOLERANCE);
      if (odd >= 0) {
        const allIds = sorted.map((s) => s.id);
        issues.push({
          severity: "warning",
          category: "inconsistent-spacing",
          message:
            `Row at y=${band.y.toFixed(1)} has inconsistent gaps between elements: ` +
            `gaps are [${gaps.map((g) => g.toFixed(1)).join(", ")}] ` +
            `(mean ${mean.toFixed(1)}, spread ${spread.toFixed(1)}). ` +
            `Use nudge_element on the appropriate ids to equalise.`,
          elementIds: allIds,
        });
      }
    }
  }

  // Build per-element summary
  const perElement = elements.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    zIndex: e.zIndex,
    flags: elementFlags.get(e.id) ?? [],
  }));

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;

  const headline =
    errors > 0
      ? `${errors} layout error${errors === 1 ? "" : "s"}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`
      : warnings > 0
        ? `${warnings} layout warning${warnings === 1 ? "" : "s"} (no errors).`
        : "All layout checks pass.";

  const recommendedAction =
    errors > 0
      ? `Apply the suggested update_element / reorder_layer fixes from each error.`
      : warnings > 0
        ? `Address each warning's fix suggestion if the design intent matches.`
        : `No fix needed - proceed to render or to the next scene.`;

  return {
    ok: true,
    sceneId: scene.id,
    sceneName: scene.name,
    elementCount: elements.length,
    elements: perElement,
    issues,
    severityCounts: { errors, warnings, info },
    headline,
    recommendedAction,
  };
};
