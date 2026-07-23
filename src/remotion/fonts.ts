import { loadFont as loadCairo } from "@remotion/google-fonts/Cairo";
import { loadFont as loadTajawal } from "@remotion/google-fonts/Tajawal";
import { loadFont as loadAmiri } from "@remotion/google-fonts/Amiri";
import { loadFont as loadReemKufi } from "@remotion/google-fonts/ReemKufi";
import { loadFont as loadElMessiri } from "@remotion/google-fonts/ElMessiri";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";

/**
 * The font NAMES/descriptions live in src/fontCatalog.ts (shared with the
 * system prompt, which has no reason to import Remotion's font-loading
 * code). This file is the other half: it actually registers each one so
 * both the live preview (this module is imported by the editor's Preview
 * component) and final render (Remotion Studio/Lambda) have them
 * available. Keep this list in sync with fontCatalog.ts.
 */
let loaded = false;

export function ensureFontsLoaded() {
  if (loaded) return;
  loaded = true;
  loadCairo();
  loadTajawal();
  loadAmiri();
  loadReemKufi();
  loadElMessiri();
  loadInter();
  loadSpaceGrotesk();
  loadPlayfairDisplay();
  loadJetBrainsMono();
  loadBebasNeue();
}
