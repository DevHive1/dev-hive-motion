import React from "react";
import type { Composition } from "../../../schema/scene";
import { totalDurationInFrames } from "../../../schema/scene";

interface SceneStripProps {
  composition: Composition;
  selectedSceneId: string | null;
  soloSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onToggleSolo: (sceneId: string) => void;
}

export const SceneStrip: React.FC<SceneStripProps> = ({
  composition,
  selectedSceneId,
  soloSceneId,
  onSelectScene,
  onToggleSolo,
}) => {
  const totalFrames = Math.max(1, totalDurationInFrames(composition));

  return (
    <div className="scene-strip-container">
      <div className="scene-strip-header">
        <span className="strip-title">Timeline Strip</span>
        <span className="strip-meta">
          {composition.scenes.length} scenes • {(totalFrames / composition.fps).toFixed(1)}s total
        </span>
      </div>

      <div className="scene-strip-track">
        {composition.scenes.map((scene, i) => {
          const widthPercent = (scene.durationInFrames / totalFrames) * 100;
          const isSelected = scene.id === selectedSceneId;
          const isSolo = scene.id === soloSceneId;

          return (
            <div
              key={scene.id}
              className={`scene-strip-block ${isSelected ? "selected" : ""} ${
                isSolo ? "solo" : ""
              }`}
              style={{
                width: `${Math.max(5, widthPercent)}%`,
                backgroundColor: scene.backgroundColor,
              }}
              onClick={() => onSelectScene(scene.id)}
            >
              <div className="strip-block-content">
                <span className="strip-block-num">{i + 1}</span>
                <span className="strip-block-name">{scene.name}</span>
                <span className="strip-block-dur">
                  {(scene.durationInFrames / composition.fps).toFixed(1)}s
                </span>
              </div>

              <button
                className={`strip-solo-btn ${isSolo ? "active" : ""}`}
                title="Solo scene"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSolo(scene.id);
                }}
              >
                {isSolo ? "◉" : "○"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
