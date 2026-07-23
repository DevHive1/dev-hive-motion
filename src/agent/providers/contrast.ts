export interface ContrastResult {
  ratio: number;
  passesNormalText: boolean; // WCAG AA, ratio >= 4.5
  passesLargeText: boolean; // WCAG AA for large/bold text, ratio >= 3
  verdict: string;
}

function parseColor(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const rgb = color.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Standard WCAG contrast ratio between two colors (hex or rgb()/rgba()).
 * Use before finalizing a text color against its background/highlight -
 * catches the "looks fine to me, unreadable to everyone else" mistake.
 */
export function checkContrast(foreground: string, background: string): ContrastResult {
  const fg = parseColor(foreground);
  const bg = parseColor(background);

  if (!fg || !bg) {
    throw new Error(
      `Couldn't parse one of the colors ("${foreground}", "${background}") - use hex (#ffffff) or rgb()/rgba().`,
    );
  }

  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  const passesNormalText = ratio >= 4.5;
  const passesLargeText = ratio >= 3;

  let verdict: string;
  if (passesNormalText) {
    verdict = "Good contrast - readable at any text size.";
  } else if (passesLargeText) {
    verdict = "Only readable at large/bold sizes (48px+ or bold 32px+) - risky for smaller text.";
  } else {
    verdict = "Poor contrast - likely hard to read at any size. Pick a lighter/darker foreground or add a highlightColor/textShadow.";
  }

  return { ratio: Math.round(ratio * 100) / 100, passesNormalText, passesLargeText, verdict };
}
