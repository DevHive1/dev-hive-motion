import React, { useMemo } from "react";

interface AudioWaveformProps {
  width: number;
  height: number;
  color?: string;
  seed?: string | number;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  width,
  height,
  color = "rgba(255, 255, 255, 0.45)",
  seed = "audio",
}) => {
  const bars = useMemo(() => {
    const numBars = Math.max(10, Math.floor(width / 3));
    const result: number[] = [];
    let hash = 0;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }

    for (let i = 0; i < numBars; i++) {
      const pseudoRandom = Math.sin(hash + i * 0.7) * 10000;
      const rawVal = Math.abs(pseudoRandom - Math.floor(pseudoRandom));
      // Shape into realistic audio envelope (peaks and valleys)
      const envelope = Math.sin((i / numBars) * Math.PI);
      const barHeight = Math.max(0.15, rawVal * 0.85 * (0.4 + 0.6 * envelope));
      result.push(barHeight);
    }
    return result;
  }, [width, seed]);

  const barWidth = 2;
  const gap = 1;

  return (
    <svg
      width={width}
      height={height}
      className="audio-waveform-svg"
      style={{ display: "block", overflow: "hidden", opacity: 0.85 }}
    >
      {bars.map((val, i) => {
        const barH = val * (height * 0.8);
        const y = (height - barH) / 2;
        const x = i * (barWidth + gap);
        if (x > width) return null;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            fill={color}
            rx={1}
          />
        );
      })}
    </svg>
  );
};
