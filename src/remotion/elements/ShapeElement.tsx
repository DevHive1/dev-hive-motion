import React from "react";
import { useVideoConfig } from "remotion";
import type { ShapeElement as ShapeElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

/**
 * Render a ShapeElement. shape can be:
 *  - "rectangle" (default): filled rectangle, border-radius optional.
 *  - "circle": filled circle (border-radius: 50% forced).
 *  - "line": a thin stroke. The element's WIDTH is the line length
 *    (along the longer axis), and the smaller of width/height is the
 *    line thickness. Orientation is horizontal if width >= height,
 *    otherwise vertical. `fill` is the line color. Use a 0-0.5
 *    thickness for hair-lines, 0.5-1.5 for accents, 2-4 for emphasis.
 *  - "border": a 4-edge frame inset from the element's box. The
 *    element's box is the area inside the frame, the frame itself
 *    extends outward by `strokeWidth` (or 2px default). `fill` is the
 *    frame color. `boxShadow` works as usual for an outer glow.
 */
export const ShapeElement: React.FC<{ element: ShapeElementType; frame: number }> = ({
  element,
  frame,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const animated = computeAnimatedStyle(element, frame, canvasWidth, canvasHeight);

  const isLine = element.shape === "line";
  const isBorder = element.shape === "border";

  // For "line" shapes, force the box to be the line's bounding box
  // (length on the long axis, thickness on the short axis), and draw
  // the line itself via a 1px-tall (or 1px-wide for vertical) inset
  // div via the canvas dimensions. This avoids the messy percentage-
  // based border approach.
  if (isLine) {
    const horizontal = element.width >= element.height;
    // Map the element's percentage box to actual pixels.
    const pxLengthPx = horizontal
      ? (element.width / 100) * canvasWidth
      : (element.height / 100) * canvasHeight;
    const pxThick = Math.max(1, horizontal
      ? (element.height / 100) * canvasHeight
      : (element.width / 100) * canvasWidth);

    return (
      <div
        data-element-id={element.id}
        data-shape="line"
        style={{
          position: "absolute",
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          height: `${element.height}%`,
          display: "flex",
          alignItems: "center",
          justifyContent: horizontal ? "flex-start" : "center",
          background: "transparent",
          pointerEvents: "none",
          zIndex: element.zIndex,
          ...styleToCss(animated),
        }}
      >
        <div
          style={{
            // The visible line.
            ...(horizontal
              ? { width: `${(pxLengthPx / canvasWidth) * 100}%`, height: `${pxThick}px` }
              : { width: `${pxThick}px`, height: `${(pxLengthPx / canvasHeight) * 100}%` }),
            background: element.fill,
            // Lines don't get a border - they're strokes, not boxes.
            border: "none",
            borderRadius: 0,
            // Optional glow: if a boxShadow is set, the line gets it
            // (so you can do e.g. a subtle outer glow on a divider).
            boxShadow: element.boxShadow,
            opacity: element.opacity,
          }}
        />
      </div>
    );
  }

  if (isBorder) {
    // A border is a 4-edge frame. We draw it as a transparent box with
    // a colored border on all sides, sized to the element's box.
    return (
      <div
        data-element-id={element.id}
        data-shape="border"
        style={{
          position: "absolute",
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          height: `${element.height}%`,
          background: "transparent",
          border: `${element.strokeWidth || 2}px solid ${element.strokeColor ?? element.fill}`,
          borderRadius: element.borderRadius,
          boxShadow: element.boxShadow,
          filter: element.blurPx > 0 ? `blur(${element.blurPx}px)` : undefined,
          backdropFilter: element.backdropBlurPx > 0 ? `blur(${element.backdropBlurPx}px)` : undefined,
          WebkitBackdropFilter: element.backdropBlurPx > 0 ? `blur(${element.backdropBlurPx}px)` : undefined,
          mixBlendMode: element.mixBlendMode as React.CSSProperties["mixBlendMode"],
          zIndex: element.zIndex,
          ...styleToCss(animated),
        }}
      />
    );
  }

  // Rectangle or circle - the original behavior.
  return (
    <div
      data-element-id={element.id}
      data-shape={element.shape}
      style={{
        position: "absolute",
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        height: `${element.height}%`,
        background: element.gradient
          ? `linear-gradient(${element.gradient.angleDeg}deg, ${element.gradient.from}, ${element.gradient.to})`
          : element.fill,
        borderRadius: element.shape === "circle" ? "50%" : element.borderRadius,
        border: element.strokeWidth > 0 ? `${element.strokeWidth}px solid ${element.strokeColor ?? "#000"}` : undefined,
        filter: element.blurPx > 0 ? `blur(${element.blurPx}px)` : undefined,
        backdropFilter: element.backdropBlurPx > 0 ? `blur(${element.backdropBlurPx}px)` : undefined,
        WebkitBackdropFilter: element.backdropBlurPx > 0 ? `blur(${element.backdropBlurPx}px)` : undefined,
        boxShadow: element.boxShadow,
        mixBlendMode: element.mixBlendMode as React.CSSProperties["mixBlendMode"],
        zIndex: element.zIndex,
        ...styleToCss(animated),
      }}
    />
  );
};
