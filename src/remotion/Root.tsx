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
      calculateMetadata={async ({ props }: { props: z.infer<typeof RootPropsSchema> }) => {
        const parsed = CompositionSchema.parse(props.composition);
        // Use totalDurationInFrames so that transition overlaps are subtracted
        // (same logic as src/schema/scene.ts:totalDurationInFrames), otherwise
        // the Remotion timeline grows by the sum of transition durations → trailing black frames.
        const sceneSum = parsed.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
        const transitionOverlap = parsed.scenes
          .slice(1)
          .reduce((sum, s) => sum + (s.transitionIn?.durationInFrames ?? 0), 0);
        const durationInFrames = Math.max(1, sceneSum - transitionOverlap);
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
