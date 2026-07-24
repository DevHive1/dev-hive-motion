import React, { useState } from "react";
import type { Composition } from "../../schema/scene";

interface StoryboardPanelProps {
  composition: Composition;
  onSelectScene?: (sceneId: string) => void;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({ composition, onSelectScene }) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
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

  const handleCopy = () => {
    if (!sb) return;
    const text = `${sb.title}\nConcept: ${sb.concept}\nMood: ${sb.moodDirection}\n\nScenes:\n` +
      sb.scenes.map((s, i) => `${i + 1}. ${s.name}: ${s.purpose}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!sb) {
    return (
      <div className="storyboard-panel storyboard-empty-container">
        <div className="storyboard-empty">
          <div className="storyboard-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="storyboard-empty-title">Production Storyboard & Plan</div>
          <div className="storyboard-empty-desc">
            No storyboard generated yet. Ask the AI Agent to build a video — it will create a full narrative blueprint, scene breakdown, and creative direction here.
          </div>
          <div className="storyboard-example-prompt">
            <span>Try asking:</span>
            <code>"Create a 5-scene product launch video for DevHive Motion"</code>
          </div>
        </div>
      </div>
    );
  }

  const builtCount = composition.scenes.length;
  const plannedCount = sb.scenes.length;
  const progress = plannedCount > 0 ? Math.min(100, Math.round((builtCount / plannedCount) * 100)) : 0;

  return (
    <div className="storyboard-panel">
      {/* Executive Header Banner */}
      <div className="storyboard-hero-card">
        <div className="storyboard-hero-top">
          <div className="storyboard-badge-group">
            <span className="storyboard-type-tag">PRODUCTION BLUEPRINT</span>
            <span className="storyboard-status-tag">
              <span className="status-dot" />
              {progress === 100 ? "FULLY BUILT" : `${builtCount}/${plannedCount} SCENES READY`}
            </span>
          </div>
          <div className="storyboard-actions">
            <button className="storyboard-btn secondary" onClick={handleCopy} title="Copy plan summary">
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
            <button className="storyboard-btn primary" onClick={handleDownload} title="Export Markdown storyboard">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 12l-4-4h2.5V3h3v5H12L8 12z" />
                <rect x="2" y="13" width="12" height="1.5" rx="0.75" />
              </svg>
              Export .md
            </button>
          </div>
        </div>

        <h2 className="storyboard-main-title">{sb.title}</h2>

        <div className="storyboard-concept-box">
          <div className="storyboard-concept-label">CORE CONCEPT & DIRECTION</div>
          <p className="storyboard-concept-text">{sb.concept}</p>
        </div>

        <div className="storyboard-meta-grid">
          <div className="storyboard-meta-card">
            <span className="meta-card-icon">🎨</span>
            <div>
              <div className="meta-card-label">Mood & Aesthetic</div>
              <div className="meta-card-val">{sb.moodDirection}</div>
            </div>
          </div>

          {sb.narrativeArc && (
            <div className="storyboard-meta-card">
              <span className="meta-card-icon">🎭</span>
              <div>
                <div className="meta-card-label">Narrative Arc</div>
                <div className="meta-card-val">{sb.narrativeArc}</div>
              </div>
            </div>
          )}
        </div>

        {/* Progress Tracker Bar */}
        <div className="storyboard-progress-container">
          <div className="storyboard-progress-info">
            <span>Composition Build Progress</span>
            <span>{progress}% Completed ({builtCount} of {plannedCount} scenes)</span>
          </div>
          <div className="storyboard-progress-track">
            <div className="storyboard-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Scene Production List Header */}
      <div className="storyboard-scenes-header">
        <div className="storyboard-scenes-title">
          <span>SCENE BREAKDOWN</span>
          <span className="scene-count-pill">{sb.scenes.length} Scenes</span>
        </div>
        <button
          className="storyboard-toggle-all-btn"
          onClick={() => setExpandedIdx(expandedIdx === null ? 0 : null)}
        >
          {expandedIdx === null ? "Expand First" : "Collapse All"}
        </button>
      </div>

      {/* Scene Cards List */}
      <div className="storyboard-scenes-list">
        {sb.scenes.map((scene, i) => {
          const isExpanded = expandedIdx === i;
          const matchingScene = composition.scenes[i];
          const isBuilt = Boolean(matchingScene);

          return (
            <div
              key={i}
              className={`storyboard-card-v2 ${isExpanded ? "expanded" : ""} ${isBuilt ? "is-built" : ""}`}
            >
              {/* Card Header Bar */}
              <div
                className="storyboard-card-header-v2"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
              >
                <div className="card-left-group">
                  <div className={`scene-index-badge ${isBuilt ? "built" : ""}`}>
                    {isBuilt ? "✓" : i + 1}
                  </div>
                  <div className="scene-title-group">
                    <div className="scene-name-text">
                      Scene {i + 1}: {scene.name}
                    </div>
                    <div className="scene-purpose-text">{scene.purpose}</div>
                  </div>
                </div>

                <div className="card-right-group">
                  {isBuilt ? (
                    <span className="scene-built-pill">✓ Built</span>
                  ) : (
                    <span className="scene-pending-pill">⏳ Planned</span>
                  )}

                  {isBuilt && matchingScene && onSelectScene && (
                    <button
                      className="scene-select-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScene(matchingScene.id);
                      }}
                      title="Select in editor"
                    >
                      Jump
                    </button>
                  )}

                  <span className={`chevron-icon ${isExpanded ? "open" : ""}`}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M2 4l4 4 4-4H2z" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Card Body Details */}
              {isExpanded && (
                <div className="storyboard-card-body-v2">
                  {scene.contentNotes && (
                    <div className="detail-section highlight">
                      <div className="detail-label">📝 Content & Facts</div>
                      <div className="detail-content">{scene.contentNotes}</div>
                    </div>
                  )}

                  {scene.keyElements && (
                    <div className="detail-section">
                      <div className="detail-label">🎨 Key Visual Elements</div>
                      <div className="detail-content">{scene.keyElements}</div>
                    </div>
                  )}

                  <div className="detail-row-grid">
                    {scene.animationNote && (
                      <div className="detail-chip-card">
                        <span className="chip-icon">✨</span>
                        <div>
                          <div className="chip-title">Animation</div>
                          <div className="chip-desc">{scene.animationNote}</div>
                        </div>
                      </div>
                    )}

                    {scene.transitionNote && (
                      <div className="detail-chip-card">
                        <span className="chip-icon">🔀</span>
                        <div>
                          <div className="chip-title">Transition In</div>
                          <div className="chip-desc">{scene.transitionNote}</div>
                        </div>
                      </div>
                    )}

                    {scene.narrativeBeat && (
                      <div className="detail-chip-card">
                        <span className="chip-icon">📖</span>
                        <div>
                          <div className="chip-title">Narrative Beat</div>
                          <div className="chip-desc">{scene.narrativeBeat}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

