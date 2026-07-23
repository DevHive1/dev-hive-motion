import React from "react";
import type { Animation, AnimatableProperty, Easing } from "../../../schema/scene";
import { generateId } from "../../../core/utils/id";

interface AnimationEditorProps {
  animations: Animation[];
  onUpdateAnimations: (animations: Animation[]) => void;
  sceneDurationInFrames: number;
}

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
      easing: "easeInOut",
    };
    onUpdateAnimations([...animations, newAnim]);
  };

  const removeAnimation = (id: string) => {
    onUpdateAnimations(animations.filter((a) => a.id !== id));
  };

  const updateAnim = (id: string, patch: Partial<Animation>) => {
    onUpdateAnimations(
      animations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
  };

  return (
    <div className="animation-editor">
      <div className="section-label">Animations ({animations.length})</div>

      {animations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No animations attached yet.</div>
        </div>
      ) : (
        animations.map((anim) => (
          <div key={anim.id} className="animation-card">
            <div className="field-row">
              <div className="field">
                <label>Property</label>
                <select
                  value={anim.property}
                  onChange={(e) =>
                    updateAnim(anim.id, { property: e.target.value as typeof anim.property })
                  }
                >
                  <option value="opacity">Opacity (0-1)</option>
                  <option value="x">X offset (% canvas)</option>
                  <option value="y">Y offset (% canvas)</option>
                  <option value="scale">Scale (multiplier)</option>
                  <option value="rotation">Rotation (°)</option>
                </select>
              </div>
              <button
                className="remove-btn"
                title="Delete animation"
                onClick={() => removeAnimation(anim.id)}
              >
                ✕
              </button>
            </div>

            <div className="field-row">
              <div className="field">
                <label>From</label>
                <input
                  type="number"
                  step={anim.property === "opacity" ? 0.1 : 1}
                  value={anim.from}
                  onChange={(e) => updateAnim(anim.id, { from: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>To</label>
                <input
                  type="number"
                  step={anim.property === "opacity" ? 0.1 : 1}
                  value={anim.to}
                  onChange={(e) => updateAnim(anim.id, { to: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Start Frame</label>
                <input
                  type="number"
                  min={0}
                  max={sceneDurationInFrames}
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
                  onChange={(e) =>
                    updateAnim(anim.id, { durationInFrames: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="field">
              <label>Easing</label>
              <select
                value={anim.easing}
                onChange={(e) =>
                  updateAnim(anim.id, { easing: e.target.value as typeof anim.easing })
                }
              >
                <option value="linear">Linear</option>
                <option value="easeIn">Ease In</option>
                <option value="easeOut">Ease Out</option>
                <option value="easeInOut">Ease In Out</option>
              </select>
            </div>
          </div>
        ))
      )}

      <button className="add-animation-btn" onClick={addAnimation}>
        + Add Keyframe Animation
      </button>
    </div>
  );
};
