import { Easing as RemotionEasing, interpolate } from "remotion";
import type { Animation, SceneElement } from "../schema/scene";

// ─── Easing map ──────────────────────────────────────────────────────────────
// Standard types
const easingFn = (name: Animation["easing"]) => {
  switch (name) {
    case "linear":    return RemotionEasing.linear;
    case "easeIn":    return RemotionEasing.in(RemotionEasing.ease);
    case "easeOut":   return RemotionEasing.out(RemotionEasing.ease);
    case "easeInOut": return RemotionEasing.inOut(RemotionEasing.ease);

    // Spring — cubic approximation: fast start, slight overshoot, settle
    case "spring":
      return RemotionEasing.out(RemotionEasing.bezier(0.34, 1.56, 0.64, 1));

    // Bounce — hits target then rebounds 3 times before settling
    case "bounce":
      return (t: number): number => {
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
        if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
        t -= 2.625 / 2.75;
        return 7.5625 * t * t + 0.984375;
      };

    // Elastic — snap past the target then oscillate back
    case "elastic":
      return (t: number): number => {
        if (t === 0 || t === 1) return t;
        const p = 0.3;
        const s = p / 4;
        return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
      };

    default: return RemotionEasing.linear;
  }
};

export interface AnimatedStyle {
  opacity: number;
  /** Pixels, already converted from the animation's percent-of-canvas value. */
  offsetXPx: number;
  offsetYPx: number;
  scale: number;
  rotation: number;
}

/**
 * Returns ONLY the animation-driven contribution for the current frame.
 * Handles:
 *  - All easing types including spring, bounce, elastic
 *  - Loop animations (loop:true, loopCount:0 = infinite or N times)
 *
 * Never touches the element's base x/y/width/height — those are CSS percent.
 */
export function computeAnimatedStyle(
  element: SceneElement,
  frameInScene: number,
  canvasWidth: number,
  canvasHeight: number,
): AnimatedStyle {
  const style: AnimatedStyle = {
    opacity: element.opacity,
    offsetXPx: 0,
    offsetYPx: 0,
    scale: 1,
    rotation: element.rotation,
  };

  for (const anim of element.animations) {
    let localFrame = frameInScene;

    // ── Loop resolution ──────────────────────────────────────────────────
    if (anim.loop) {
      const totalDur = anim.durationInFrames;
      const elapsed = Math.max(0, frameInScene - anim.startFrame);
      const cycleIndex = Math.floor(elapsed / totalDur);
      const loopCount = anim.loopCount ?? 0;
      const maxCycles = loopCount === 0 ? Infinity : loopCount + 1;

      if (cycleIndex < maxCycles) {
        // Remap frame into the current cycle
        localFrame = anim.startFrame + (elapsed % totalDur);
      } else {
        // Animation is done — clamp to final value
        localFrame = anim.startFrame + totalDur;
      }
    }

    const value = interpolate(
      localFrame,
      [anim.startFrame, anim.startFrame + anim.durationInFrames],
      [anim.from, anim.to],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easingFn(anim.easing),
      },
    );

    switch (anim.property) {
      case "opacity":   style.opacity = value; break;
      case "x":         style.offsetXPx = (value / 100) * canvasWidth; break;
      case "y":         style.offsetYPx = (value / 100) * canvasHeight; break;
      case "scale":     style.scale = value; break;
      case "rotation":  style.rotation = value; break;
    }
  }

  return style;
}

export function styleToCss(style: AnimatedStyle): React.CSSProperties {
  return {
    opacity: style.opacity,
    transform: `translate(${style.offsetXPx}px, ${style.offsetYPx}px) scale(${style.scale}) rotate(${style.rotation}deg)`,
  };
}
