import React, { useEffect, useRef, useState } from "react";
import { useVideoConfig, delayRender, continueRender } from "remotion";
import type { CustomElement as CustomElementType } from "../../schema/scene";
import { computeAnimatedStyle, styleToCss } from "../animate";

export const CustomElement: React.FC<{ element: CustomElementType; frame: number }> = ({
  element,
  frame,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const animated = computeAnimatedStyle(element, frame, canvasWidth, canvasHeight);
  const hasContinuedRef = useRef(false);

  // Tells Remotion "don't capture this frame yet" until the iframe's
  // srcDoc has actually finished loading/rendering - iframe loading is
  // asynchronous, so without this a render could screenshot the frame
  // before there's anything in it, even though it looks fine in the live
  // preview (which just plays back in real time and doesn't hit this race).
  const [handle] = useState(() =>
    delayRender(`Loading custom element "${element.name}"`),
  );

  useEffect(() => {
    return () => {
      if (!hasContinuedRef.current) {
        hasContinuedRef.current = true;
        continueRender(handle);
      }
    };
  }, [handle]);

  const onIframeLoad = () => {
    if (!hasContinuedRef.current) {
      hasContinuedRef.current = true;
      continueRender(handle);
    }
  };

  const srcDoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${element.transparentBackground ? "transparent" : "#000"};
  }
  ${element.css}
</style>
</head>
<body>
${element.html}
${element.js ? `<script>${element.js}</script>` : ""}
</body>
</html>`;

  return (
    <div
      data-element-id={element.id}
      style={{
        position: "absolute",
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        height: `${element.height}%`,
        zIndex: element.zIndex,
        ...styleToCss(animated),
      }}
    >
      <iframe
        srcDoc={srcDoc}
        title={element.name}
        onLoad={onIframeLoad}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "transparent",
        }}
      />
    </div>
  );
};
