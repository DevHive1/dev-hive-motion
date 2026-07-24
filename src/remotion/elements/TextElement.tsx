import React from "react";
import { useVideoConfig } from "remotion";
import type { TextElement as TextElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

export const TextElement: React.FC<{ element: TextElementType; frame: number }> = ({
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
        display: "flex",
        alignItems: "center",
        justifyContent:
          element.textAlign === "left"
            ? "flex-start"
            : element.textAlign === "right"
              ? "flex-end"
              : "center",
        zIndex: element.zIndex,
        ...styleToCss(animated),
      }}
    >
      <span
        style={{
          fontSize: element.fontSize,
          fontFamily: `${element.fontFamily}, sans-serif`,
          fontWeight: element.fontWeight,
          // Gradient overrides solid color when present
          color: element.gradient ? "transparent" : element.color,
          backgroundImage: element.gradient
            ? `linear-gradient(${element.gradient.angleDeg ?? 135}deg, ${element.gradient.from}, ${element.gradient.to})`
            : undefined,
          WebkitBackgroundClip: element.gradient ? "text" : undefined,
          backgroundClip: element.gradient ? "text" : undefined,
          textAlign: element.textAlign,
          width: element.highlightColor ? undefined : "100%",
          whiteSpace: "pre-wrap",
          letterSpacing: element.letterSpacing ? `${element.letterSpacing}px` : undefined,
          textShadow:
            typeof element.textShadow === "string"
              ? element.textShadow
              : element.textShadow
                ? "0 2px 16px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.45)"
                : undefined,
          WebkitTextStroke:
            element.strokeWidth && element.strokeColor
              ? `${element.strokeWidth}px ${element.strokeColor}`
              : undefined,
          backgroundColor: element.highlightColor,
          padding: element.highlightColor ? "0.2em 0.5em" : undefined,
          borderRadius: element.highlightColor ? "0.15em" : undefined,
          display: element.highlightColor ? "inline-block" : "block",
        }}
      >
        {element.text}
      </span>
    </div>
  );
};
