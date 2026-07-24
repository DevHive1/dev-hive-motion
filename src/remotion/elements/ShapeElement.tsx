import React from "react";
import { useVideoConfig } from "remotion";
import type { ShapeElement as ShapeElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

export const ShapeElement: React.FC<{ element: ShapeElementType; frame: number }> = ({
  element,
  frame,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const animated = computeAnimatedStyle(element, frame, canvasWidth, canvasHeight);

  return (
    <div
      data-element-id={element.id}
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
