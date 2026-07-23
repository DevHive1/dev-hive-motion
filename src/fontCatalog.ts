/**
 * Every font name here MUST have a matching loadFont() call in
 * src/remotion/fonts.ts, or text using it will silently fall back to a
 * default font at render time. This file has no Remotion import on purpose
 * - it's used by both the renderer and the (server-side) system prompt.
 */
export const AVAILABLE_FONTS: Record<string, string> = {
  // Arabic-first (all also render Latin text fine)
  "Cairo": "Modern Arabic/Latin sans - general-purpose headline or body.",
  "Tajawal": "Geometric Arabic/Latin sans - clean, contemporary headlines.",
  "Amiri": "Classical Arabic serif (Naskh) - historical/documentary/editorial titles.",
  "Reem Kufi": "Geometric Kufi display - bold, distinctive, high-impact short titles.",
  "El Messiri": "Arabic/Latin display with character - titles and kickers.",
  // Latin-focused
  "Inter": "Default body/UI sans - clean, neutral, highly readable.",
  "Space Grotesk": "Modern geometric sans - tech/product-style headlines.",
  "Playfair Display": "Elegant serif - editorial/luxury/historical Latin titles.",
  "JetBrains Mono": "Monospace - kickers, timecodes, small uppercase labels.",
  "Bebas Neue": "Bold condensed display - punchy short Latin headlines.",
};
