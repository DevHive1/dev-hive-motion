import React, { useState } from "react";
import { AudioWaveform } from "./AudioWaveform";

export interface TimelineClipData {
  id: string;
  sceneId: string;
  elementId?: string;
  name: string;
  type: "text" | "image" | "video" | "shape" | "custom" | "audio" | "scene";
  startFrame: number;
  durationInFrames: number;
  trackIndex: number;
  color: string;
  locked?: boolean;
  hidden?: boolean;
  fadeStartFrames?: number;
  fadeEndFrames?: number;
  transitionInType?: string;
}

interface ClipBlockProps {
  clip: TimelineClipData;
  zoomScale: number;
  trackHeight: number;
  isSelected: boolean;
  fps: number;
  onSelect: (clipId: string, e: React.MouseEvent) => void;
  onTrimLeft: (clipId: string, deltaFrames: number) => void;
  onTrimRight: (clipId: string, deltaFrames: number) => void;
  onMoveClip: (clipId: string, deltaFrames: number, newTrackIndex?: number) => void;
}

const TYPE_ICONS: Record<TimelineClipData["type"], string> = {
  text: "T",
  image: "🖼️",
  video: "🎬",
  shape: "🟩",
  custom: "◆",
  audio: "🎵",
  scene: "🎞️",
};

export const ClipBlock: React.FC<ClipBlockProps> = ({
  clip,
  zoomScale,
  trackHeight,
  isSelected,
  fps,
  onSelect,
  onTrimLeft,
  onTrimRight,
  onMoveClip,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const leftPx = clip.startFrame * zoomScale;
  const widthPx = Math.max(16, clip.durationInFrames * zoomScale);
  const durationSeconds = (clip.durationInFrames / fps).toFixed(1);

  // Dragging logic for clip movement
  const handlePointerDownCenter = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(clip.id, e as unknown as React.MouseEvent);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const initialStartFrame = clip.startFrame;

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaFrames = Math.round(deltaX / zoomScale);
      const targetFrames = Math.max(0, initialStartFrame + deltaFrames);
      onMoveClip(clip.id, targetFrames);
    };

    const handlePointerUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // Trimming Left Handle
  const handleTrimLeftPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const initialStartFrame = clip.startFrame;

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaFrames = Math.round(deltaX / zoomScale);
      const targetStart = Math.max(0, initialStartFrame + deltaFrames);
      onTrimLeft(clip.id, targetStart);
    };

    const handlePointerUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // Trimming Right Handle
  const handleTrimRightPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const initialDuration = clip.durationInFrames;

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaFrames = Math.round(deltaX / zoomScale);
      const targetDuration = Math.max(5, initialDuration + deltaFrames);
      onTrimRight(clip.id, targetDuration);
    };

    const handlePointerUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const fadeStartPx = ((clip.fadeStartFrames ?? 15) / clip.durationInFrames) * widthPx;
  const fadeEndPx = ((clip.fadeEndFrames ?? 15) / clip.durationInFrames) * widthPx;

  return (
    <div
      className={`nle-clip-block ${clip.type} ${isSelected ? "selected" : ""} ${
        clip.locked ? "locked" : ""
      }`}
      style={{
        left: leftPx,
        width: widthPx,
        height: trackHeight - 6,
        backgroundColor: clip.color,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={handlePointerDownCenter}
    >
      {/* Fade In Handle & Polygon */}
      <svg className="clip-fade-overlay" width={widthPx} height={trackHeight - 6}>
        <polygon
          points={`0,0 ${Math.min(widthPx, fadeStartPx)},0 0,${trackHeight - 6}`}
          fill="rgba(255, 255, 255, 0.15)"
        />
        <polygon
          points={`${widthPx},0 ${Math.max(0, widthPx - fadeEndPx)},0 ${widthPx},${
            trackHeight - 6
          }`}
          fill="rgba(255, 255, 255, 0.15)"
        />
      </svg>

      {/* Audio Waveform for Audio/Video clips */}
      {(clip.type === "audio" || clip.type === "video") && widthPx > 30 && (
        <div className="clip-waveform-container">
          <AudioWaveform width={widthPx} height={trackHeight - 12} seed={clip.id} />
        </div>
      )}

      {/* Transition Badge on Left Edge */}
      {clip.transitionInType && clip.transitionInType !== "none" && (
        <div className="clip-transition-badge" title={`Transition: ${clip.transitionInType}`}>
          ⚡ {clip.transitionInType}
        </div>
      )}

      {/* Clip Content Label */}
      <div className="clip-label-container">
        <span className="clip-type-icon">{TYPE_ICONS[clip.type]}</span>
        <span className="clip-name">{clip.name}</span>
        {widthPx > 70 && <span className="clip-duration">{durationSeconds}s</span>}
      </div>

      {/* Left Trim Handle */}
      <div
        className="clip-trim-handle left"
        onPointerDown={handleTrimLeftPointerDown}
        title="Trim Start"
      >
        <div className="trim-bar" />
      </div>

      {/* Right Trim Handle */}
      <div
        className="clip-trim-handle right"
        onPointerDown={handleTrimRightPointerDown}
        title="Trim End"
      >
        <div className="trim-bar" />
      </div>

      {/* Fade Drag Handles (Top Left / Right) */}
      {(isHovered || isSelected) && (
        <>
          <div className="clip-fade-handle left" title="Fade In Handle" />
          <div className="clip-fade-handle right" title="Fade Out Handle" />
        </>
      )}
    </div>
  );
};
