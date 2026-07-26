import React from "react";
import type { Transition, TransitionType, TransitionDirection } from "../../../schema/scene";

interface TransitionPickerProps {
  transition?: Transition;
  onChange: (transition: Transition | undefined) => void;
}

// Curated list shown in the editor's transition picker. Backend schema
// allows every transition the @remotion/transitions library supports,
// but the picker surfaces the most-used ones; the agent can still reach
// all transitions via set_scene_transition / set_scene_transitions.
const TRANSITION_TYPES: Array<{ type: TransitionType; label: string }> = [
  { type: "fade", label: "Fade" },
  { type: "none", label: "None (hard cut)" },
  { type: "slide", label: "Slide" },
  { type: "wipe", label: "Wipe" },
  { type: "flip", label: "Flip" },
  { type: "clockWipe", label: "Clock Wipe" },
  { type: "dissolve", label: "Dissolve" },
  { type: "crossZoom", label: "Cross Zoom" },
  { type: "dreamyZoom", label: "Dreamy Zoom" },
  { type: "filmBurn", label: "Film Burn" },
  { type: "zoomBlur", label: "Zoom Blur" },
  { type: "zoomInOut", label: "Zoom In-Out" },
  { type: "iris", label: "Iris Wipe" },
  { type: "ripple", label: "Ripple" },
  { type: "swap", label: "Swap" },
  { type: "linearBlur", label: "Linear Blur" },
];

export const TransitionPicker: React.FC<TransitionPickerProps> = ({ transition, onChange }) => {
  const currentType = transition?.type ?? "none";
  const currentDirection = transition?.direction ?? "from-right";
  const currentDuration = transition?.durationInFrames ?? 15;

  const handleTypeChange = (type: typeof currentType) => {
    if (type === "none") {
      onChange(undefined);
    } else {
      onChange({
        type,
        direction: currentDirection,
        durationInFrames: currentDuration,
      });
    }
  };

  return (
    <div className="transition-picker">
      <div className="section-label">Scene In Transition</div>

      <div className="transition-grid">
        {TRANSITION_TYPES.map(({ type, label }) => (
          <button
            key={type}
            className={`transition-chip ${currentType === type ? "active" : ""}`}
            onClick={() => handleTypeChange(type)}
          >
            {label}
          </button>
        ))}
      </div>

      {currentType !== "none" && (
        <div className="transition-options" style={{ marginTop: 12 }}>
          {["slide", "wipe", "flip", "push", "reveal"].includes(currentType) && (
            <div className="field">
              <label>Direction</label>
              <select
                value={currentDirection}
                onChange={(e) =>
                  onChange({
                    type: currentType,
                    direction: e.target.value as typeof currentDirection,
                    durationInFrames: currentDuration,
                  })
                }
              >
                <option value="from-left">From Left</option>
                <option value="from-right">From Right</option>
                <option value="from-top">From Top</option>
                <option value="from-bottom">From Bottom</option>
              </select>
            </div>
          )}

          <div className="field">
            <label>Duration (frames)</label>
            <input
              type="number"
              min={5}
              max={60}
              value={currentDuration}
              onChange={(e) =>
                onChange({
                  type: currentType,
                  direction: currentDirection,
                  durationInFrames: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};
