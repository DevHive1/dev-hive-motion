import React from "react";

interface TimeRulerProps {
  totalFrames: number;
  fps: number;
  zoomScale: number; // pixels per frame
  currentFrame: number;
  onSeek: (frame: number) => void;
}

export function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  const frames = Math.floor(frame % fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const ff = String(frames).padStart(2, "0");

  return `${mm}:${ss}:${ff}`;
}

export const TimeRuler: React.FC<TimeRulerProps> = ({
  totalFrames,
  fps,
  zoomScale,
  currentFrame,
  onSeek,
}) => {
  const width = Math.max(800, totalFrames * zoomScale);

  // Calculate tick intervals based on zoomScale
  let frameInterval = fps; // Default 1 second
  if (zoomScale >= 5) frameInterval = Math.max(1, Math.floor(fps / 6)); // every 5 frames
  else if (zoomScale >= 2) frameInterval = Math.max(5, Math.floor(fps / 2)); // every 15 frames
  else if (zoomScale < 0.8) frameInterval = fps * 5; // every 5 seconds
  else if (zoomScale < 0.3) frameInterval = fps * 10; // every 10 seconds

  const ticks: Array<{ frame: number; x: number; label?: string; isMajor: boolean }> = [];

  for (let f = 0; f <= totalFrames; f += Math.max(1, Math.floor(frameInterval / 5))) {
    const x = f * zoomScale;
    const isMajor = f % frameInterval === 0;
    ticks.push({
      frame: f,
      x,
      label: isMajor ? formatTimecode(f, fps) : undefined,
      isMajor,
    });
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const seekFrame = Math.max(0, Math.min(totalFrames, Math.round(clickX / zoomScale)));
    onSeek(seekFrame);

    const handleMouseMove = (ev: MouseEvent) => {
      const moveX = ev.clientX - rect.left;
      const f = Math.max(0, Math.min(totalFrames, Math.round(moveX / zoomScale)));
      onSeek(f);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const playheadX = currentFrame * zoomScale;

  return (
    <div className="nle-time-ruler-wrapper" style={{ width }} onMouseDown={handleMouseDown}>
      <div className="nle-time-ruler">
        {ticks.map((t, i) => (
          <div
            key={i}
            className={`ruler-tick ${t.isMajor ? "major" : "minor"}`}
            style={{ left: t.x }}
          >
            {t.label && <span className="ruler-label">{t.label}</span>}
          </div>
        ))}
      </div>

      {/* Blue Playhead Top Marker */}
      <div className="nle-playhead-head" style={{ left: playheadX }}>
        <div className="playhead-triangle" />
        <span className="playhead-timecode">{formatTimecode(currentFrame, fps)}</span>
      </div>
    </div>
  );
};
