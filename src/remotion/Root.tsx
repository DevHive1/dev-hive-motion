import React from "react";
import { z } from "zod";
import { Composition as RemotionComposition } from "remotion";
import { CompositionSchema } from "../schema/scene";
import { Renderer } from "./Renderer";
import sampleComposition from "./sample-composition.json";

const RootPropsSchema = z.object({
  composition: CompositionSchema,
});

export const RemotionRoot: React.FC = () => {
  return (
    <RemotionComposition
      id="MainComposition"
      component={Renderer}
      schema={RootPropsSchema}
      // Duration/fps/dimensions are derived from the composition JSON itself,
      // so the agent (or the editor) changing scenes automatically resizes
      // the timeline - no manual re-registration needed.
      calculateMetadata={async ({ props }) => {
        const parsed = CompositionSchema.parse(props.composition);
        const durationInFrames = Math.max(
          1,
          parsed.scenes.reduce((sum, s) => sum + s.durationInFrames, 0),
        );
        return {
          durationInFrames,
          fps: parsed.fps,
          width: parsed.width,
          height: parsed.height,
        };
      }}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        composition: CompositionSchema.parse(sampleComposition),
      }}
    />
  );
};
