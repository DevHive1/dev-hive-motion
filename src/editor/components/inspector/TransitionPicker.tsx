import React from "react";
import type { Transition, TransitionType, TransitionDirection } from "../../../schema/scene";

interface TransitionPickerProps {
  transition?: Transition;
  onChange: (transition: Transition | undefined) => void;
}

const TRANSITION_TYPES: Array<{ type: TransitionType; label: string }> = [
  { type: "fade", label: "Fade" },
  { type: "slide", label: "Slide" },
  { type: "wipe", label: "Wipe" },
  { type: "flip", label: "Flip" },
  { type: "clockWipe", label: "Clock Wipe" },
  { type: "dissolve", label: "Dissolve" },
  { type: "zoom", label: "Zoom" },
  { type: "push", label: "Push" },
  { type: "reveal", label: "Reveal" },
  { type: "none", label: "None" },
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
