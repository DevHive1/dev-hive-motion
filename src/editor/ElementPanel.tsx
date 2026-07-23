import React from "react";
import type { Composition, SceneElement } from "../schema/scene";

const TYPE_GLYPH: Record<SceneElement["type"], string> = {
  text: "T",
  image: "I",
  video: "V",
  shape: "S",
  custom: "◆",
  audio: "♪",
};

export const ElementPanel: React.FC<{
  composition: Composition;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  onSelectElement: (elementId: string | null) => void;
  onPatchElement: (elementId: string, patch: Record<string, unknown>) => void;
}> = ({ composition, selectedSceneId, selectedElementId, onSelectElement, onPatchElement }) => {
  const scene = composition.scenes.find((s) => s.id === selectedSceneId);
  const element = scene?.elements.find((e) => e.id === selectedElementId);

  return (
    <div className="panel elements">
      <div className="section-label">Elements</div>

      {!scene && (
        <div className="empty-state">
          <div className="empty-state-icon">◱</div>
          <div className="empty-state-text">Select a scene to see its elements.</div>
        </div>
      )}

      {scene && scene.elements.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">This scene is empty.</div>
        </div>
      )}

      {scene?.elements.map((el) => (
        <div
          key={el.id}
          className={`element-row ${el.id === selectedElementId ? "selected" : ""}`}
          onClick={() => onSelectElement(el.id)}
        >
          <span className={`element-icon ${el.type}`}>{TYPE_GLYPH[el.type]}</span>
          <span className="element-row-name">{el.name}</span>
          <span className="element-type-tag">{el.type}</span>
        </div>
      ))}

      {element && (
        <>
          <div className="section-label">Properties</div>

          {element.type === "text" && (
            <>
              <div className="field">
                <label>Text</label>
                <textarea
                  value={element.text}
                  rows={3}
                  onChange={(e) => onPatchElement(element.id, { text: e.target.value })}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Color</label>
                  <input
                    type="color"
                    value={element.color}
                    onChange={(e) => onPatchElement(element.id, { color: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Font size</label>
                  <input
                    type="number"
                    value={element.fontSize}
                    onChange={(e) => onPatchElement(element.id, { fontSize: Number(e.target.value) })}
                  />
                </div>
              </div>
            </>
          )}

          {element.type === "shape" && (
            <div className="field">
              <label>Fill</label>
              <input
                type="color"
                value={element.fill}
                onChange={(e) => onPatchElement(element.id, { fill: e.target.value })}
              />
            </div>
          )}

          {(element.type === "image" || element.type === "video") && (
            <div className="field">
              <label>Source URL</label>
              <input
                type="text"
                value={element.src}
                onChange={(e) => onPatchElement(element.id, { src: e.target.value })}
              />
            </div>
          )}

          {element.type === "custom" && (
            <>
              <div className="field">
                <label>HTML</label>
                <textarea
                  value={element.html}
                  rows={5}
                  style={{ fontFamily: "var(--mono)", fontSize: 11 }}
                  onChange={(e) => onPatchElement(element.id, { html: e.target.value })}
                />
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea
                  value={element.css}
                  rows={5}
                  style={{ fontFamily: "var(--mono)", fontSize: 11 }}
                  onChange={(e) => onPatchElement(element.id, { css: e.target.value })}
                />
              </div>
              <div className="field">
                <label>JS (preview only - see hint below)</label>
                <textarea
                  value={element.js ?? ""}
                  rows={4}
                  style={{ fontFamily: "var(--mono)", fontSize: 11 }}
                  onChange={(e) => onPatchElement(element.id, { js: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="field-row">
            <div className="field">
              <label>X %</label>
              <input
                type="number"
                min={-50}
                max={150}
                value={element.x}
                onChange={(e) => onPatchElement(element.id, { x: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Y %</label>
              <input
                type="number"
                min={-50}
                max={150}
                value={element.y}
                onChange={(e) => onPatchElement(element.id, { y: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Width %</label>
              <input
                type="number"
                min={1}
                max={200}
                value={element.width}
                onChange={(e) => onPatchElement(element.id, { width: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Height %</label>
              <input
                type="number"
                min={1}
                max={200}
                value={element.height}
                onChange={(e) => onPatchElement(element.id, { height: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Rotation°</label>
              <input
                type="number"
                value={element.rotation}
                onChange={(e) => onPatchElement(element.id, { rotation: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Opacity</label>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={element.opacity}
                onChange={(e) => onPatchElement(element.id, { opacity: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Layer (zIndex)</label>
              <input
                type="number"
                value={element.zIndex}
                onChange={(e) => onPatchElement(element.id, { zIndex: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="layer-btn"
                  onClick={() => {
                    const maxZ = Math.max(...(scene?.elements.map((el) => el.zIndex) ?? [0]));
                    onPatchElement(element.id, { zIndex: maxZ + 1 });
                  }}
                >
                  Front
                </button>
                <button
                  className="layer-btn"
                  onClick={() => {
                    const minZ = Math.min(...(scene?.elements.map((el) => el.zIndex) ?? [0]));
                    onPatchElement(element.id, { zIndex: minZ - 1 });
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Start frame</label>
              <input
                type="number"
                value={element.startFrame}
                onChange={(e) => onPatchElement(element.id, { startFrame: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Duration (frames)</label>
              <input
                type="number"
                value={element.durationInFrames}
                onChange={(e) =>
                  onPatchElement(element.id, { durationInFrames: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="hint-note">
            {element.animations.length} animation(s) attached — ask the agent to add or adjust
            motion (e.g. "make it fade in over half a second").
          </div>
        </>
      )}
    </div>
  );
};
