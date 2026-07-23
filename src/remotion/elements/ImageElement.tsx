import React, { useState } from "react";
import { Img, useVideoConfig } from "remotion";
import type { ImageElement as ImageElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

export const ImageElement: React.FC<{ element: ImageElementType; frame: number }> = ({
  element,
  frame,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const animated = computeAnimatedStyle(element, frame, canvasWidth, canvasHeight);
  const [failed, setFailed] = useState(false);

  if (!element.src) {
    return null;
  }

  return (
    <div
      data-element-id={element.id}
      style={{
        position: "absolute",
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        height: `${element.height}%`,
        borderRadius: element.borderRadius,
        boxShadow: element.boxShadow,
        zIndex: element.zIndex,
        ...styleToCss(animated),
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: element.borderRadius,
        }}
      >
        {failed ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "repeating-linear-gradient(45deg, #3a1414, #3a1414 10px, #2a0f0f 10px, #2a0f0f 20px)",
              color: "#ff8a8a",
              fontFamily: "monospace",
              fontSize: 16,
              textAlign: "center",
              padding: 16,
            }}
          >
            <div>⚠ image failed to load</div>
            <div style={{ fontSize: 12, opacity: 0.8, wordBreak: "break-all" }}>{element.src}</div>
          </div>
        ) : (
          <Img
            src={element.src}
            onError={() => setFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: element.objectFit,
            }}
          />
        )}
      </div>
    </div>
  );
};
