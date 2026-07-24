import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { Composition, Scene, SceneElement, Transition } from "../schema/scene";
import { TextElement } from "./elements/TextElement";
import { ImageElement } from "./elements/ImageElement";
import { VideoElement } from "./elements/VideoElement";
import { ShapeElement } from "./elements/ShapeElement";
import { CustomElement } from "./elements/CustomElement";
import { AudioElement as AudioElementRenderer } from "./elements/AudioElement";
import { ensureFontsLoaded } from "./fonts";

ensureFontsLoaded();

const ElementSwitch: React.FC<{ element: SceneElement; frame: number }> = ({
  element,
  frame,
}) => {
  switch (element.type) {
    case "text":
      return <TextElement element={element} frame={frame} />;
    case "image":
      return <ImageElement element={element} frame={frame} />;
    case "video":
      return <VideoElement element={element} frame={frame} />;
    case "shape":
      return <ShapeElement element={element} frame={frame} />;
    case "custom":
      return <CustomElement element={element} frame={frame} />;
    case "audio":
      return <AudioElementRenderer element={element} />;
  }
};

const SceneLayer: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: scene.backgroundColor }}>
      {[...scene.elements]
        .filter((element) => !element.hidden)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((element) => (
          <Sequence
            key={element.id}
            from={element.startFrame}
            durationInFrames={element.durationInFrames}
            layout="none"
          >
            <ElementSwitch element={element} frame={frame - element.startFrame} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

function presentationFor(
  transition: Transition,
  canvasWidth: number,
  canvasHeight: number,
): ReturnType<typeof fade> {
  switch (transition.type) {
    case "slide":
      return slide({ direction: transition.direction }) as unknown as ReturnType<typeof fade>;
    case "wipe":
      return wipe({ direction: transition.direction }) as unknown as ReturnType<typeof fade>;
    case "flip":
      return flip({ direction: transition.direction }) as unknown as ReturnType<typeof fade>;
    case "clockWipe":
      return clockWipe({ width: canvasWidth, height: canvasHeight }) as unknown as ReturnType<
        typeof fade
      >;
    case "fade":
    case "none":
    default:
      return fade();
  }
}

/**
 * Root renderer. Props conform to CompositionSchema (see src/schema/scene.ts).
 * Scenes play back-to-back; a scene with `transitionIn` set (and type !==
 * "none") overlaps with the previous scene by transitionIn.durationInFrames
 * instead of hard-cutting into it.
 */
export const Renderer: React.FC<{ composition: Composition }> = ({ composition }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Global audio tracks (background music / project-wide VO) */}
      {composition.globalAudio?.map((track) => (
        <Sequence key={track.id} from={track.startFrame} durationInFrames={track.durationInFrames} layout="none">
          <AudioElementRenderer element={track} />
        </Sequence>
      ))}
      <TransitionSeries>
        {composition.scenes.map((scene, i) => {
          const transition = scene.transitionIn;
          const showTransition = i > 0 && transition && transition.type !== "none";

          return (
            <React.Fragment key={scene.id}>
              {showTransition && transition && (
                <TransitionSeries.Transition
                  presentation={presentationFor(transition, composition.width, composition.height)}
                  timing={linearTiming({ durationInFrames: transition.durationInFrames })}
                />
              )}
              <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                <SceneLayer scene={scene} />
              </TransitionSeries.Sequence>
            </React.Fragment>
          );
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
