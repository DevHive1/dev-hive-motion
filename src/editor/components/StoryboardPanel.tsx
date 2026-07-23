import React, { useState } from "react";
import type { Composition } from "../../schema/scene";

interface StoryboardPanelProps {
  composition: Composition;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({ composition }) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const sb = composition.storyboard;

  const handleDownload = () => {
    if (!sb) return;
    const lines = [
      `# ${sb.title}`,
      ``,
      `**Concept:** ${sb.concept}`,
      `**Mood & Direction:** ${sb.moodDirection}`,
      sb.narrativeArc ? `**Narrative Arc:** ${sb.narrativeArc}` : "",
      ``,
      `---`,
      ``,
      ...sb.scenes.flatMap((s, i) => [
        `## Scene ${i + 1}: ${s.name}`,
        `**Purpose:** ${s.purpose}`,
        s.narrativeBeat ? `**Narrative Beat:** ${s.narrativeBeat}` : "",
        s.contentNotes ? `**Content Notes:** ${s.contentNotes}` : "",
        `**Key Elements:** ${s.keyElements}`,
        s.animationNote ? `**Animation:** ${s.animationNote}` : "",
        s.transitionNote ? `**Transition In:** ${s.transitionNote}` : "",
        ``,
      ]),
    ]
      .filter((l) => l !== undefined && l !== null)
      .join("\n");

    const blob = new Blob([lines], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sb.title.replace(/\s+/g, "-").toLowerCase()}-storyboard.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!sb) {
    return (
      <div className="storyboard-panel">
        <div className="storyboard-empty">
          <div className="storyboard-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <div className="storyboard-empty-title">No Storyboard Yet</div>
          <div className="storyboard-empty-desc">
            Ask the AI agent to plan a video — it builds a detailed storyboard here before touching the timeline.
          </div>
          <code className="storyboard-example-prompt">"Create an explainer video about renewable energy"</code>
        </div>
      </div>
    );
  }

  const builtCount = composition.scenes.length;
  const plannedCount = sb.scenes.length;
  const progress = plannedCount > 0 ? Math.round((builtCount / plannedCount) * 100) : 0;

  return (
    <div className="storyboard-panel">
      {/* Header */}
      <div className="storyboard-header">
        <div className="storyboard-meta">
          <div className="storyboard-title">{sb.title}</div>
          <div className="storyboard-concept">{sb.concept}</div>
          <div className="storyboard-mood-chip">{sb.moodDirection}</div>
          {sb.narrativeArc && (
            <div className="storyboard-arc">
              <span className="storyboard-arc-label">Arc</span>
              {sb.narrativeArc}
            </div>
          )}
        </div>
        <button className="storyboard-download-btn" onClick={handleDownload} title="Download storyboard as Markdown">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12l-4-4h2.5V3h3v5H12L8 12z" />
            <rect x="2" y="13" width="12" height="1.5" rx="0.75" />
          </svg>
          Export
        </button>
      </div>

      {/* Build Progress */}
      <div className="storyboard-progress-row">
        <span className="storyboard-progress-label">
          {builtCount} / {plannedCount} scenes built
        </span>
        <div className="storyboard-progress-bar">
          <div className="storyboard-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="storyboard-progress-pct">{progress}%</span>
      </div>

      {/* Scene Cards */}
      <div className="storyboard-scenes">
        {sb.scenes.map((scene, i) => {
          const isExpanded = expandedIdx === i;
          const isBuilt = i < builtCount;
          return (
            <div
              key={i}
              className={`storyboard-scene-card ${isExpanded ? "expanded" : ""} ${isBuilt ? "built" : ""}`}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
            >
              <div className="storyboard-scene-header">
                <div className="storyboard-scene-badge">
                  {isBuilt ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="#22c55e">
                      <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <span className="storyboard-scene-num">{i + 1}</span>
                  )}
                </div>
                <div className="storyboard-scene-info">
                  <div className="storyboard-scene-name">{scene.name}</div>
                  <div className="storyboard-scene-purpose">{scene.purpose}</div>
                </div>
                <div className="storyboard-scene-chevron">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"
                    style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>
                    <path d="M2 4l4 4 4-4H2z" />
                  </svg>
                </div>
              </div>

              {isExpanded && (
                <div className="storyboard-scene-body">
                  {scene.contentNotes && (
                    <StoryboardField icon="📝" label="Content Notes" value={scene.contentNotes} />
                  )}
                  {scene.keyElements && (
                    <StoryboardField icon="🎨" label="Key Elements" value={scene.keyElements} />
                  )}
                  {scene.animationNote && (
                    <StoryboardField icon="✨" label="Animation" value={scene.animationNote} />
                  )}
                  {scene.transitionNote && (
                    <StoryboardField icon="🔀" label="Transition In" value={scene.transitionNote} />
                  )}
                  {scene.narrativeBeat && (
                    <StoryboardField icon="📖" label="Narrative Beat" value={scene.narrativeBeat} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StoryboardField: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="storyboard-field">
    <div className="storyboard-field-label">
      {icon} {label}
    </div>
    <div className="storyboard-field-value">{value}</div>
  </div>
);
