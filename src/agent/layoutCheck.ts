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
 * Animations and accent detection - the kinds of polish gaps that the
 * agent's report called out (text-only scenes, no motion, no accents).
 * Lives next to computeLayoutFlags so both report the same scene the
 * same way regardless of which tool the agent called.
 */
export interface ScenePolishInput {
  elements: Array<{
    id?: string;
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    startFrame?: number;
    animations?: Array<{
      property?: string;
      from?: number;
      to?: number;
      startFrame?: number;
      durationInFrames?: number;
    }>;
  }>;
  backgroundColor?: string;
  transitionIn?: { type?: string; durationInFrames?: number } | null;
  /** The previous scene's transitionIn (so we can spot "no transition into this scene"). */
  previousTransitionIn?: { type?: string; durationInFrames?: number } | null;
  /** The next scene exists, used to detect missing transitions between scenes. */
  hasNextScene?: boolean;
}

export interface PolishFlags {
  /** Single text element with no shape/image/video/custom accent - reads as a slide. */
  textOnlyScene: boolean;
  /** No element has any animation - the scene is static. */
  staticScene: boolean;
  /** Background is fully transparent and there are no full-bleed background elements. */
  transparentBackground: boolean;
  /** Scene has a previous scene but no transition between them. */
  missingIncomingTransition: boolean;
  /** Scene has a next scene but no transition out of this scene. */
  missingOutgoingTransition: boolean;
  /**
   * The largest non-text element starts at frame 0 AND uses an opacity
   * 0→1 fade-in. This is the "fake hold-then-reveal" pattern - the user
   * sees the image fading in over the background instead of an
   * intentional hold of black / calm background before the hero arrives.
   * Fix: set the hero element's startFrame to the hold duration (e.g.
   * 30-45 frames) and start its opacity animation at the same time, so
   * the background is visible alone for the hold, then the hero reveals.
   */
  heroElementStartsAtFrameZero: boolean;
}

export function analyzePolish(scene: ScenePolishInput): PolishFlags {
  const nonTextElements = scene.elements.filter((e) => e.type !== "text");
  const totalElements = scene.elements.length;
  const totalAnimations = scene.elements.reduce(
    (sum, e) => sum + (Array.isArray(e.animations) ? e.animations.length : 0),
    0,
  );
  // Transparent = either explicit transparent (rgba(0,0,0,0)) or unset
  // background. The store's default is "#0b0b0f", so absence is a sign
  // the agent forgot to set it.
  const bg = scene.backgroundColor ?? "";
  const isTransparentBg =
    bg === "transparent" ||
    bg === "" ||
    /rgba\([^)]*,\s*0\s*\)/.test(bg) ||
    bg.toLowerCase() === "#00000000";

  return {
    textOnlyScene: totalElements === 1 && scene.elements[0]?.type === "text",
    staticScene: totalElements > 0 && totalAnimations === 0,
    transparentBackground:
      isTransparentBg &&
      !nonTextElements.some((e) => {
        // A full-bleed element (x<=0, y<=0, width>=100, height>=100) acts
        // as the background even when scene.backgroundColor is unset.
        const el = e as { x?: number; y?: number; width?: number; height?: number };
        return (
          (el.x ?? 50) <= 0 &&
          (el.y ?? 50) <= 0 &&
          (el.width ?? 0) >= 100 &&
          (el.height ?? 0) >= 100
        );
      }),
    missingIncomingTransition:
      scene.previousTransitionIn !== undefined && // a previous scene exists
      scene.previousTransitionIn === null,
    missingOutgoingTransition:
      Boolean(scene.hasNextScene) && scene.transitionIn == null,
    heroElementStartsAtFrameZero: detectFakeHoldReveal(scene.elements),
  };
}

/**
 * Detect the "fake hold-then-reveal" pattern: the most prominent
 * non-text element starts at frame 0 with an opacity 0→1 animation.
 * This is the pattern that produces "no calm black screen" - the
 * background is technically visible alone during the first few frames
 * but the eye reads it as a fade-in, not a hold.
 *
 * A real hold-then-reveal has startFrame > 0 on the hero element AND
 * its opacity animation starting at the same frame, so the background
 * is alone for the entire hold period.
 */
function detectFakeHoldReveal(
  elements: NonNullable<ScenePolishInput["elements"]>,
): boolean {
  // Pick the biggest non-text element - that's the "hero" of the scene.
  const nonText = elements.filter(
    (e) => e.type !== "text" && typeof e.width === "number" && typeof e.height === "number",
  );
  if (nonText.length === 0) return false;
  const hero = nonText.reduce((biggest, el) => {
    const a = (el.width ?? 0) * (el.height ?? 0);
    const b = (biggest.width ?? 0) * (biggest.height ?? 0);
    return a > b ? el : biggest;
  });
  // Hero starts at frame 0.
  if ((hero.startFrame ?? 0) > 0) return false;
  // Hero has an opacity animation that goes 0 → 1.
  const anims = Array.isArray(hero.animations) ? hero.animations : [];
  const hasOpacityFadeIn = anims.some(
    (a) =>
      a?.property === "opacity" &&
      (a.from ?? 0) === 0 &&
      (a.to ?? 0) === 1,
  );
  return hasOpacityFadeIn;
}

/**
 * Build the human-readable flag strings from the polish analysis. The
 * messages are written for the agent, not for end users - they tell the
 * model exactly which tool to call next.
 */
export function polishFlagStrings(flags: PolishFlags): string[] {
  const out: string[] = [];
  if (flags.textOnlyScene) {
    out.push(
      "Scene is a single text element on a plain background - this reads as a slide, not a video frame. " +
        "Add at least one non-text accent: a soft blurred circle for depth (add_shape_element with blurPx 60-120), a glass panel behind the text (semi-transparent fill + backdropBlurPx 12-24), a gradient backdrop, an icon, or a small custom SVG. " +
        "Even a single add_shape_element changes the perceived production value significantly.",
    );
  }
  if (flags.staticScene) {
    out.push(
      "Scene has no animations on any element - it will appear instantly and stay flat. " +
        "Add at least one entrance: call add_animation with property:'opacity' from:0 to:1, or property:'y' with a small from offset (e.g. 8) for a subtle rise. " +
        "Stagger multiple elements with different startFrame values (5-15 frame gaps) so they don't all pop in together.",
    );
  }
  if (flags.transparentBackground) {
    out.push(
      "Background is transparent and no full-bleed background element exists - " +
        "set scene.backgroundColor to a real color (or add a full-bleed shape/image element) so the scene isn't black where elements don't cover.",
    );
  }
  if (flags.missingIncomingTransition) {
    out.push(
      "This scene has a previous scene but no transition between them - the cut will feel abrupt. " +
        "Call set_scene_transition on this scene to add a fade, slide, or wipe from the previous one. " +
        "Or call set_all_transitions to apply one transition type to every scene boundary in one shot.",
    );
  }
  if (flags.missingOutgoingTransition) {
    out.push(
      "This scene has a next scene but no transition out - the cut to the next scene will feel abrupt. " +
        "Call set_scene_transition on the NEXT scene to add an incoming transition, or set_all_transitions to apply one type to all boundaries.",
    );
  }
  if (flags.heroElementStartsAtFrameZero) {
    out.push(
      "The largest non-text element (the hero) starts at frame 0 with an opacity 0→1 fade. " +
        "This is a fake hold-then-reveal - the background is visible only during the first few frames of the fade, " +
        "so the eye reads it as a fade-in, not as a deliberate 'calm' hold. " +
        "If the user asked for a hold/calm/quiet moment, or if the scene is the opening of the project, " +
        "set the hero element's startFrame to the hold duration (30-45 frames for a 1-1.5s calm beat) " +
        "and move its opacity animation's startFrame to the same value. " +
        "Then the background sits alone for the hold, then the hero reveals. " +
        "Also: if the user said 'calm/quiet/transforms into/stillness before', set this scene's transitionIn to { type: 'none' } - " +
        "a fade-in transition contradicts 'calm'.",
    );
  }
  return out;
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
