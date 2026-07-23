import React from "react";
import type { Composition } from "../schema/scene";

function storyboardToMarkdown(composition: Composition): string {
  const sb = composition.storyboard;
  if (!sb) return "";
  const lines = [
    `# ${sb.title}`,
    "",
    `**Concept:** ${sb.concept}`,
    "",
  ];
  if (sb.narrativeArc) {
    lines.push(`**Narrative arc:** ${sb.narrativeArc}`, "");
  }
  lines.push(`**Mood direction:** ${sb.moodDirection}`, "", "## Scenes", "");
  sb.scenes.forEach((scene, i) => {
    lines.push(`### ${i + 1}. ${scene.name}`);
    lines.push("");
    lines.push(`- **Purpose:** ${scene.purpose}`);
    if (scene.narrativeBeat) lines.push(`- **Narrative beat:** ${scene.narrativeBeat}`);
    lines.push(`- **Key elements:** ${scene.keyElements}`);
    if (scene.contentNotes) lines.push(`- **Content:** ${scene.contentNotes}`);
    if (scene.transitionNote) lines.push(`- **Transition:** ${scene.transitionNote}`);
    if (scene.animationNote) lines.push(`- **Animation:** ${scene.animationNote}`);
    lines.push("");
  });
  return lines.join("\n");
}

function downloadStoryboard(composition: Composition) {
  const markdown = storyboardToMarkdown(composition);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(composition.storyboard?.title ?? "storyboard").replace(/[^a-z0-9أ-ي\s-]/gi, "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export const Timeline: React.FC<{
  composition: Composition;
  selectedSceneId: string | null;
  soloSceneId: string | null;
  onToggleSolo: (sceneId: string) => void;
  onSelectScene: (sceneId: string) => void;
  onAddScene?: () => void;
  onDeleteScene?: (sceneId: string) => void;
}> = ({
  composition,
  selectedSceneId,
  soloSceneId,
  onToggleSolo,
  onSelectScene,
  onAddScene,
  onDeleteScene,
}) => {
  const storyboard = composition.storyboard;

  return (
    <div className="panel timeline scenes-panel">
      {storyboard && (
        <>
          <div className="section-label">Storyboard</div>
          <div className="storyboard-card">
            <div className="storyboard-title">{storyboard.title}</div>
            <div className="storyboard-concept">{storyboard.concept}</div>
            <div className="storyboard-mood">{storyboard.moodDirection}</div>
            <button className="storyboard-download-btn" onClick={() => downloadStoryboard(composition)}>
              ⬇ Download plan
            </button>
          </div>
        </>
      )}

      <div className="section-header-row">
        <div className="section-label">Scenes ({composition.scenes.length})</div>
        {onAddScene && (
          <button className="add-scene-btn" onClick={onAddScene} title="Add Scene">
            + Scene
          </button>
        )}
      </div>

      {composition.scenes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🎬</div>
          <div className="empty-state-text">No scenes yet — ask the agent to build something.</div>
        </div>
      )}
      {composition.scenes.map((scene, i) => (
        <div
          key={scene.id}
          className={`scene-block ${scene.id === selectedSceneId ? "selected" : ""}`}
          onClick={() => onSelectScene(scene.id)}
        >
          <div className="scene-swatch" style={{ background: scene.backgroundColor }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="scene-block-name">
              {i + 1}. {scene.name}
            </div>
            <div className="scene-block-meta">
              {(scene.durationInFrames / composition.fps).toFixed(1)}s · {scene.elements.length} el
              {scene.transitionIn && scene.transitionIn.type !== "none"
                ? ` · ${scene.transitionIn.type} in`
                : ""}
            </div>
          </div>
          <div className="scene-block-actions">
            <button
              className={`scene-solo-btn ${soloSceneId === scene.id ? "active" : ""}`}
              title="Preview this scene in isolation"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSolo(scene.id);
              }}
            >
              {soloSceneId === scene.id ? "◉ solo" : "○ solo"}
            </button>
            {onDeleteScene && composition.scenes.length > 1 && (
              <button
                className="scene-delete-btn"
                title="Delete scene"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteScene(scene.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
