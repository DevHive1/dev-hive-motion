import React from "react";
import type { Animation } from "../../../schema/scene";
import { generateId } from "../../../core/utils/id";

interface AnimationEditorProps {
  animations: Animation[];
  onUpdateAnimations: (animations: Animation[]) => void;
  sceneDurationInFrames: number;
}

const PROPERTY_UNITS: Record<string, string> = {
  opacity: "(0 → 1)",
  x: "(% canvas offset)",
  y: "(% canvas offset)",
  scale: "(multiplier, 1 = normal)",
  rotation: "(degrees)",
};

export const AnimationEditor: React.FC<AnimationEditorProps> = ({
  animations,
  onUpdateAnimations,
  sceneDurationInFrames,
}) => {
  const addAnimation = () => {
    const newAnim: Animation = {
      id: generateId("anim"),
      property: "opacity",
      from: 0,
      to: 1,
      startFrame: 0,
      durationInFrames: Math.min(20, sceneDurationInFrames),
      easing: "easeOut",
    };
    onUpdateAnimations([...animations, newAnim]);
  };

  const removeAnimation = (id: string) => {
    onUpdateAnimations(animations.filter((a) => a.id !== id));
  };

  const updateAnim = (id: string, patch: Partial<Animation>) => {
    onUpdateAnimations(animations.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  return (
    <div className="animation-editor">
      <div className="section-label">Animations ({animations.length})</div>

      {animations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No animations yet. Add one below.</div>
        </div>
      ) : (
        animations.map((anim) => {
          const startPct = Math.min(100, (anim.startFrame / sceneDurationInFrames) * 100);
          const widthPct = Math.min(100 - startPct, (anim.durationInFrames / sceneDurationInFrames) * 100);
          const endFrame = anim.startFrame + anim.durationInFrames;

          return (
            <div key={anim.id} className="animation-card">
              {/* Property + remove */}
              <div className="field-row">
                <div className="field">
                  <label>Property</label>
                  <select
                    value={anim.property}
                    onChange={(e) =>
                      updateAnim(anim.id, { property: e.target.value as Animation["property"] })
                    }
                  >
                    <option value="opacity">Opacity {PROPERTY_UNITS.opacity}</option>
                    <option value="x">X Offset {PROPERTY_UNITS.x}</option>
                    <option value="y">Y Offset {PROPERTY_UNITS.y}</option>
                    <option value="scale">Scale {PROPERTY_UNITS.scale}</option>
                    <option value="rotation">Rotation {PROPERTY_UNITS.rotation}</option>
                  </select>
                </div>
                <button
                  className="remove-btn"
                  title="Remove animation"
                  onClick={() => removeAnimation(anim.id)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path
                      d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              {/* From / To */}
              <div className="field-row">
                <div className="field">
                  <label>From</label>
                  <input
                    type="number"
                    step={anim.property === "opacity" ? 0.05 : 1}
                    value={anim.from}
                    onChange={(e) => updateAnim(anim.id, { from: Number(e.target.value) })}
                  />
                </div>
                <div className="anim-arrow">→</div>
                <div className="field">
                  <label>To</label>
                  <input
                    type="number"
                    step={anim.property === "opacity" ? 0.05 : 1}
                    value={anim.to}
                    onChange={(e) => updateAnim(anim.id, { to: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Timing */}
              <div className="field-row">
                <div className="field">
                  <label>Start (frame)</label>
                  <input
                    type="number"
                    min={0}
                    max={sceneDurationInFrames - 1}
                    value={anim.startFrame}
                    onChange={(e) => updateAnim(anim.id, { startFrame: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Duration (frames)</label>
                  <input
                    type="number"
                    min={1}
                    max={sceneDurationInFrames}
                    value={anim.durationInFrames}
                    onChange={(e) => updateAnim(anim.id, { durationInFrames: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Easing */}
              <div className="field">
                <label>Easing</label>
                <select
                  value={anim.easing}
                  onChange={(e) => updateAnim(anim.id, { easing: e.target.value as Animation["easing"] })}
                >
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease In (accelerate)</option>
                  <option value="easeOut">Ease Out (decelerate)</option>
                  <option value="easeInOut">Ease In Out (smooth)</option>
                </select>
              </div>

              {/* ── Visual timing bar ── */}
              <div className="anim-timing-wrap">
                <div className="anim-timing-labels">
                  <span>0</span>
                  <span>{sceneDurationInFrames}f</span>
                </div>
                <div className="anim-timing-track" title={`Frames ${anim.startFrame}–${endFrame}`}>
                  <div
                    className="anim-timing-fill"
                    style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  />
                </div>
                <div className="anim-timing-info">
                  f{anim.startFrame} → f{endFrame}
                  &nbsp;·&nbsp;{((anim.durationInFrames / sceneDurationInFrames) * 100).toFixed(0)}% of scene
                </div>
              </div>
            </div>
          );
        })
      )}

      <button className="add-animation-btn" onClick={addAnimation}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
        Add Keyframe Animation
      </button>
    </div>
  );
};
