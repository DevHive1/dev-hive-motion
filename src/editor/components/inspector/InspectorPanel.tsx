import React, { useState } from "react";
import type { Composition, SceneElement, Transition } from "../../../schema/scene";
import { AnimationEditor } from "./AnimationEditor";
import { TransitionPicker } from "./TransitionPicker";

type InspectorTab = "properties" | "animations" | "transition" | "layers";

const TYPE_GLYPH: Record<SceneElement["type"], string> = {
  text: "T",
  image: "I",
  video: "V",
  shape: "S",
  custom: "◆",
  audio: "♪",
};

interface InspectorPanelProps {
  composition: Composition;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  onSelectElement: (elementId: string | null) => void;
  onPatchElement: (elementId: string, patch: Record<string, unknown>) => void;
  onDeleteElement: (elementId: string) => void;
  onDuplicateElement: (elementId: string) => void;
  onUpdateSceneTransition: (transition: Transition | undefined) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  composition,
  selectedSceneId,
  selectedElementId,
  onSelectElement,
  onPatchElement,
  onDeleteElement,
  onDuplicateElement,
  onUpdateSceneTransition,
}) => {
  const [tab, setTab] = useState<InspectorTab>("properties");
  const scene = composition.scenes.find((s) => s.id === selectedSceneId);
  const element = scene?.elements.find((e) => e.id === selectedElementId);

  return (
    <div className="panel elements inspector-panel">
      {/* Tab Navigation */}
      <div className="inspector-tabs">
        <button
          className={tab === "properties" ? "active" : ""}
          onClick={() => setTab("properties")}
        >
          Props
        </button>
        <button
          className={tab === "animations" ? "active" : ""}
          onClick={() => setTab("animations")}
        >
          Anim ({element?.animations?.length ?? 0})
        </button>
        <button
          className={tab === "transition" ? "active" : ""}
          onClick={() => setTab("transition")}
        >
          Transition
        </button>
        <button
          className={tab === "layers" ? "active" : ""}
          onClick={() => setTab("layers")}
        >
          Layers ({scene?.elements?.length ?? 0})
        </button>
      </div>

      {!scene && (
        <div className="empty-state">
          <div className="empty-state-text">Select a scene to see properties.</div>
        </div>
      )}

      {scene && tab === "transition" && (
        <TransitionPicker
          transition={scene.transitionIn}
          onChange={onUpdateSceneTransition}
        />
      )}

      {scene && tab === "layers" && (
        <div className="layer-stack">
          <div className="section-label">Layer Stack (Top → Bottom)</div>
          {[...scene.elements]
            .sort((a, b) => b.zIndex - a.zIndex)
            .map((el) => (
              <div
                key={el.id}
                className={`layer-row ${el.id === selectedElementId ? "selected" : ""}`}
                onClick={() => onSelectElement(el.id)}
              >
                <button
                  className={`icon-btn ${el.hidden ? "active" : ""}`}
                  title={el.hidden ? "Unhide" : "Hide"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatchElement(el.id, { hidden: !el.hidden });
                  }}
                >
                  {el.hidden ? "👁️‍🗨️" : "👁️"}
                </button>
                <button
                  className={`icon-btn ${el.locked ? "active" : ""}`}
                  title={el.locked ? "Unlock" : "Lock"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatchElement(el.id, { locked: !el.locked });
                  }}
                >
                  {el.locked ? "🔒" : "🔓"}
                </button>
                <button
                  className="icon-btn"
                  title="Bring Forward (Increase zIndex)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatchElement(el.id, { zIndex: el.zIndex + 1 });
                  }}
                >
                  ▲
                </button>
                <button
                  className="icon-btn"
                  title="Send Backward (Decrease zIndex)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatchElement(el.id, { zIndex: Math.max(0, el.zIndex - 1) });
                  }}
                >
                  ▼
                </button>
                <span className={`element-icon ${el.type}`}>{TYPE_GLYPH[el.type]}</span>
                <span className="element-row-name">{el.name}</span>
                <span className="z-tag">z:{el.zIndex}</span>
              </div>
            ))}
        </div>
      )}

      {element && tab === "animations" && (
        <AnimationEditor
          animations={element.animations ?? []}
          sceneDurationInFrames={scene?.durationInFrames ?? 150}
          onUpdateAnimations={(anims) => onPatchElement(element.id, { animations: anims })}
        />
      )}

      {element && tab === "properties" && (
        <div className="property-editor">
          <div className="field-row header-controls">
            <div className="element-title-badge">
              <span className={`element-icon ${element.type}`}>{TYPE_GLYPH[element.type]}</span>
              <span className="element-title-text">{element.name}</span>
            </div>
            <div className="quick-actions">
              <button
                className="icon-btn"
                title="Duplicate Element"
                onClick={() => onDuplicateElement(element.id)}
              >
                📋
              </button>
              <button
                className="icon-btn danger"
                title="Delete Element"
                onClick={() => onDeleteElement(element.id)}
              >
                🗑
              </button>
            </div>
          </div>

          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={element.name}
              onChange={(e) => onPatchElement(element.id, { name: e.target.value })}
            />
          </div>

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
                  <label>Font Size (px)</label>
                  <input
                    type="number"
                    value={element.fontSize}
                    onChange={(e) => onPatchElement(element.id, { fontSize: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Color</label>
                  <input
                    type="color"
                    value={element.color}
                    onChange={(e) => onPatchElement(element.id, { color: e.target.value })}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Font Weight</label>
                  <select
                    value={element.fontWeight}
                    onChange={(e) => onPatchElement(element.id, { fontWeight: Number(e.target.value) })}
                  >
                    <option value={400}>Normal (400)</option>
                    <option value={600}>Semibold (600)</option>
                    <option value={700}>Bold (700)</option>
                    <option value={900}>Black (900)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Align</label>
                  <select
                    value={element.textAlign}
                    onChange={(e) => onPatchElement(element.id, { textAlign: e.target.value })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {element.type === "shape" && (
            <>
              <div className="field-row">
                <div className="field">
                  <label>Shape</label>
                  <select
                    value={element.shape}
                    onChange={(e) => onPatchElement(element.id, { shape: e.target.value })}
                  >
                    <option value="rectangle">Rectangle</option>
                    <option value="circle">Circle</option>
                  </select>
                </div>
                <div className="field">
                  <label>Fill</label>
                  <input
                    type="color"
                    value={element.fill}
                    onChange={(e) => onPatchElement(element.id, { fill: e.target.value })}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Border Radius (px)</label>
                  <input
                    type="number"
                    value={element.borderRadius}
                    onChange={(e) => onPatchElement(element.id, { borderRadius: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Backdrop Blur (px)</label>
                  <input
                    type="number"
                    value={element.backdropBlurPx}
                    onChange={(e) => onPatchElement(element.id, { backdropBlurPx: Number(e.target.value) })}
                  />
                </div>
              </div>
            </>
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

          <div className="section-label" style={{ marginTop: 12 }}>Position & Bounds (%)</div>
          <div className="field-row">
            <div className="field">
              <label>X %</label>
              <input
                type="number"
                value={element.x}
                onChange={(e) => onPatchElement(element.id, { x: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Y %</label>
              <input
                type="number"
                value={element.y}
                onChange={(e) => onPatchElement(element.id, { y: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>W %</label>
              <input
                type="number"
                value={element.width}
                onChange={(e) => onPatchElement(element.id, { width: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>H %</label>
              <input
                type="number"
                value={element.height}
                onChange={(e) => onPatchElement(element.id, { height: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Rotation (°)</label>
              <input
                type="number"
                value={element.rotation}
                onChange={(e) => onPatchElement(element.id, { rotation: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Opacity (0-1)</label>
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
        </div>
      )}
    </div>
  );
};
