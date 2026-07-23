import React, { useState } from "react";
import { OffthreadVideo, useVideoConfig } from "remotion";
import type { VideoElement as VideoElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

export const VideoElement: React.FC<{ element: VideoElementType; frame: number }> = ({
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
        overflow: "hidden",
        zIndex: element.zIndex,
        ...styleToCss(animated),
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
          <div>⚠ video failed to load</div>
          <div style={{ fontSize: 12, opacity: 0.8, wordBreak: "break-all" }}>{element.src}</div>
        </div>
      ) : (
        <OffthreadVideo
          src={element.src}
          volume={element.muted ? 0 : element.volume}
          playbackRate={element.playbackRate}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: element.objectFit,
          }}
        />
      )}
    </div>
  );
};
