import React from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { Composition } from "../schema/scene";
import { Renderer } from "../remotion/Renderer";
import { totalDurationInFrames } from "../schema/scene";

export interface PreviewProps {
  composition: Composition;
  playerRef?: React.RefObject<PlayerRef>;
}

export const Preview: React.FC<PreviewProps> = ({ composition, playerRef }) => {
  const durationInFrames = Math.max(1, totalDurationInFrames(composition));

  return (
    <Player
      ref={playerRef}
      component={Renderer}
      inputProps={{ composition }}
      durationInFrames={durationInFrames}
      fps={composition.fps}
      compositionWidth={composition.width}
      compositionHeight={composition.height}
      style={{ width: "100%", height: "100%" }}
      controls
      loop
    />
  );
};
