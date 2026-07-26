import { sceneStore } from "../../../server/sceneStore";
import type { SceneElement } from "../../../schema/scene";

/**
 * fit_text_to_box — error.txt item 9.
 *
 * When the agent puts long text into a fixed-size box, it often overflows
 * silently. This tool measures (with a deterministic per-font char-width
 * heuristic - good enough for "is the text going to fit or not", not
 * pixel-perfect) and returns a suggested patch to apply via
 * update_element. It does NOT auto-apply - the agent reviews the
 * suggested patch and decides whether to use it, since sometimes
 * wrapping or shortening the text is the better fix.
 *
 * Returns at most one of:
 *   - { fits: true } — current settings fit fine, no change needed
 *   - { fits: false, suggestedPatch: { fontSize, width, height } }
 *       — apply via update_element to make the text fit
 *   - { fits: false, recommendation: "shorten" | "wrap" }
 *       — can't fit even at the smallest reasonable font size; the agent
 *         should shorten the text or restructure the layout
 *
 * Heuristic: per-font average char width as a fraction of fontSize. Latin
 * fonts use ~0.55, Arabic fonts slightly wider at ~0.6 to account for
 * connected-letter shaping. This is intentionally rough - a perfect
 * measurement would need to actually render the text in a real font,
 * which we can't do synchronously in the agent loop. The point is to
 * catch "the text is way too long for this box" before it gets to render.
 */
export const fitTextToBoxDef = {
  type: "function",
  function: {
    name: "fit_text_to_box",
    description:
      "Measure whether a text element's text actually fits inside its box (current x/y/width/height/fontSize) and return a suggested patch if not. Use this BEFORE rendering when you suspect the text might overflow. Does NOT auto-apply the patch - returns it so you can decide (sometimes shortening the text is better than shrinking the font). Works on text elements only; for custom HTML/SVG use edit_custom_element_code or a manual check. The measurement is a per-font char-width heuristic, not a pixel-perfect render - it catches 'definitely won't fit' and 'fits comfortably' but may be off by ~10% on the edge cases, which is fine for the yes/no decision the agent needs.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        elementId: { type: "string" },
        minFontSize: { type: "number", description: "Smallest fontSize the result is allowed to suggest. Defaults to 16 - below that, readability suffers and the tool will instead recommend shortening the text. Must be > 0." },
        maxWidth: { type: "number", description: "Override the max width percent the box can grow to. Defaults to the element's current width. Useful for 'fit horizontally but don't grow wider than 80% of the canvas'." },
        maxHeight: { type: "number", description: "Override the max height percent the box can grow to. Defaults to the element's current height." },
      },
      required: ["sceneId", "elementId"],
    },
  },
};

type FitArgs = {
  sceneId: string;
  elementId: string;
  minFontSize?: number;
  maxWidth?: number;
  maxHeight?: number;
};

const ARABIC_FONTS = new Set(["Cairo", "Tajawal", "Amiri", "Reem Kufi", "El Messiri", "Noto Sans Arabic", "Markazi Text"]);

function estimateCharWidth(fontFamily: string, fontWeight: number | undefined): number {
  const isArabic = ARABIC_FONTS.has(fontFamily);
  let base = isArabic ? 0.6 : 0.55;
  if (fontWeight && fontWeight >= 700) base *= 1.08; // bold is wider
  if (fontFamily === "JetBrains Mono") base = 0.6;     // mono
  if (fontFamily === "Bebas Neue") base = 0.42;        // condensed
  return base;
}

function isArabicText(text: string): boolean {
  // Arabic Unicode block covers \u0600-\u06FF plus presentation forms.
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export async function fitTextToBoxImpl(args: FitArgs) {
  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === args.sceneId);
  if (!scene) throw new Error(`No scene with id "${args.sceneId}".`);

  const element = scene.elements.find((e) => e.id === args.elementId);
  if (!element) {
    throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);
  }
  if (element.type !== "text") {
    throw new Error(
      `Element "${args.elementId}" is type "${element.type}", not "text" - fit_text_to_box only works on text elements.`,
    );
  }

  const text = element.text ?? "";
  const fontSize = element.fontSize ?? 48;
  const fontFamily = element.fontFamily ?? "Inter";
  const fontWeight = element.fontWeight;
  const width = element.width ?? 80;
  const height = element.height ?? 20;

  const minFontSize = args.minFontSize ?? 16;
  const maxWidth = args.maxWidth ?? width;
  const maxHeight = args.maxHeight ?? height;

  // Char width as percent of canvas width, for a font that is `fontSize`
  // percent of canvas HEIGHT. (We treat fontSize as a percent of canvas
  // height since that's how the renderer interprets it; the canvas is
  // typically wider than tall, so a 48 fontSize on a 1080-tall canvas is
  // ~52px - but here everything's already in percent of the canvas, so
  // we just use the same units consistently.)
  const charW = estimateCharWidth(fontFamily, fontWeight);

  // Single-line width of the text at the current font size, in percent
  // of canvas width.
  const singleLineWidth = text.length * fontSize * charW;

  // Approximate line height in percent of canvas height.
  const lineHeightPct = fontSize * 1.2;

  // How many lines fit in the current box?
  const currentLinesFit = Math.max(1, Math.floor(height / lineHeightPct));
  // The longest line, if the text wraps at the current box width. For
  // simplicity we treat the box width as the wrap width and assume the
  // text can be split into roughly equal lines.
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * charW)));
  const lineCount = Math.max(1, Math.ceil(text.length / charsPerLine));

  const totalHeightNeeded = lineCount * lineHeightPct;
  const totalWidthNeeded = Math.min(width, singleLineWidth);

  const fitsWidth = totalWidthNeeded <= width;
  const fitsHeight = totalHeightNeeded <= height;

  if (fitsWidth && fitsHeight) {
    return {
      fits: true,
      currentFontSize: fontSize,
      currentBox: { width, height },
      measured: {
        singleLineWidth: Number(singleLineWidth.toFixed(2)),
        totalWidth: Number(totalWidthNeeded.toFixed(2)),
        totalHeight: Number(totalHeightNeeded.toFixed(2)),
        lineCount,
      },
    };
  }

  // Doesn't fit. Try to find a fontSize that fits both dimensions, given
  // that the box can grow up to maxWidth / maxHeight.
  // We binary-search between 0.5x current and minFontSize.
  let lowFontSize = Math.max(minFontSize, 1);
  let highFontSize = fontSize;
  let bestFontSize = fontSize;
  let bestWidth = width;
  let bestHeight = height;

  // First: can we fit by growing the box alone (no font shrink)?
  if (totalWidthNeeded <= maxWidth && totalHeightNeeded <= maxHeight) {
    return {
      fits: false,
      fitsByGrowingBox: true,
      suggestedPatch: {
        width: Math.min(maxWidth, Math.ceil(totalWidthNeeded)),
        height: Math.min(maxHeight, Math.ceil(totalHeightNeeded)),
      },
      measured: {
        singleLineWidth: Number(singleLineWidth.toFixed(2)),
        totalWidth: Number(totalWidthNeeded.toFixed(2)),
        totalHeight: Number(totalHeightNeeded.toFixed(2)),
        lineCount,
      },
    };
  }

  // Try reducing fontSize. At each candidate size, compute the new line count
  // and total dimensions and see if they fit in maxWidth / maxHeight.
  for (let candidate = fontSize; candidate >= minFontSize; candidate -= 1) {
    const cpl = Math.max(1, Math.floor(maxWidth / (candidate * charW)));
    const lines = Math.max(1, Math.ceil(text.length / cpl));
    const needH = lines * candidate * 1.2;
    const needW = Math.min(maxWidth, text.length * candidate * charW);
    if (needH <= maxHeight && needW <= maxWidth) {
      bestFontSize = candidate;
      bestWidth = Math.ceil(needW);
      bestHeight = Math.ceil(needH);
      return {
        fits: false,
        fitsByGrowingBox: false,
        suggestedPatch: {
          fontSize: bestFontSize,
          width: bestWidth,
          height: bestHeight,
        },
        measured: {
          singleLineWidthAtCurrent: Number(singleLineWidth.toFixed(2)),
          singleLineWidthAtSuggested: Number((text.length * bestFontSize * charW).toFixed(2)),
          lineCountAtSuggested: lines,
        },
        note:
          `Reduced fontSize from ${fontSize} to ${bestFontSize} and adjusted width/height. ` +
          `If this is too small, consider shortening the text instead.`,
      };
    }
  }

  // Couldn't fit even at minFontSize. Recommend shortening the text.
  const cplAtMin = Math.max(1, Math.floor(maxWidth / (minFontSize * charW)));
  const linesAtMin = Math.max(1, Math.ceil(text.length / cplAtMin));
  const needHAtMin = linesAtMin * minFontSize * 1.2;
  const tooLongByChars = Math.ceil(text.length - (maxHeight / (minFontSize * 1.2)) * cplAtMin);

  return {
    fits: false,
    recommendation: tooLongByChars > 0 ? "shorten" : "wrap",
    suggestedPatch: {
      fontSize: minFontSize,
      width: maxWidth,
      height: Math.min(maxHeight, Math.ceil(needHAtMin)),
    },
    measured: {
      charsAtMinFontSize: cplAtMin,
      linesAtMinFontSize: linesAtMin,
      textLength: text.length,
      isArabic: isArabicText(text),
    },
    note:
      tooLongByChars > 0
        ? `Even at the smallest allowed font size (${minFontSize}), the text needs ~${tooLongByChars} fewer characters to fit in the current box. Shorten the text (e.g. "${text.slice(0, Math.max(8, text.length - tooLongByChars - 2))}...") and call fit_text_to_box again.`
        : `Even at the smallest allowed font size, the text would need ${linesAtMin} lines and exceed the box height. Consider splitting the text across multiple elements or wrapping manually.`,
  };
}

// Re-export the SceneElement type so other modules importing from this
// file don't need a second import line.
export type { SceneElement };
