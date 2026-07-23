import { Easing as RemotionEasing, interpolate } from "remotion";
import type { Animation, SceneElement } from "../schema/scene";

const EASING_MAP: Record<Animation["easing"], (t: number) => number> = {
  linear: RemotionEasing.linear,
  easeIn: RemotionEasing.in(RemotionEasing.ease),
  easeOut: RemotionEasing.out(RemotionEasing.ease),
  easeInOut: RemotionEasing.inOut(RemotionEasing.ease),
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
 * Returns ONLY the animation-driven contribution for the current frame -
 * never the element's base x/y/width/height, which is applied separately
 * as CSS percent (left/top/width/height) by each element component. This
 * function's output goes exclusively into a CSS `transform`, so there is
 * no field that both this and the static position both touch.
 *
 * canvasWidth/canvasHeight (from Remotion's useVideoConfig()) are needed
 * because x/y animation from/to values are percent-of-canvas, like the
 * base position, and transform's translate() takes pixels - percentages
 * in translate() are relative to the ELEMENT's own box, not the canvas,
 * so converting to pixels here (rather than using a CSS percent transform)
 * is what keeps this correct regardless of the element's own size.
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
    const value = interpolate(
      frameInScene,
      [anim.startFrame, anim.startFrame + anim.durationInFrames],
      [anim.from, anim.to],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EASING_MAP[anim.easing],
      },
    );

    switch (anim.property) {
      case "opacity":
        style.opacity = value;
        break;
      case "x":
        style.offsetXPx = (value / 100) * canvasWidth;
        break;
      case "y":
        style.offsetYPx = (value / 100) * canvasHeight;
        break;
      case "scale":
        style.scale = value;
        break;
      case "rotation":
        style.rotation = value;
        break;
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
