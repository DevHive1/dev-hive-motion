import React from "react";
import { Audio } from "remotion";
import type { AudioElement as AudioElementType } from "../../schema/scene";

export const AudioElement: React.FC<{ element: AudioElementType }> = ({ element }) => {
  if (!element.src || element.hidden) {
    return null;
  }

  return <Audio src={element.src} volume={element.muted ? 0 : element.volume} />;
};
