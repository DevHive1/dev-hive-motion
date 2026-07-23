import type { PlayerRef } from "@remotion/player";
import React, { useState, useRef, useEffect, useMemo } from "react";
import type { Composition, SceneElement, Scene } from "../../../schema/scene";
import { totalDurationInFrames } from "../../../schema/scene";
import { TimeRuler, formatTimecode } from "./TimeRuler";
import { TrackHeader, type TrackConfig } from "./TrackHeader";
import { ClipBlock, type TimelineClipData } from "./ClipBlock";

interface NLETimelinePanelProps {
  composition: Composition;
  playerRef?: React.RefObject<PlayerRef>;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  soloSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onSelectElement: (elementId: string | null) => void;
  onToggleSolo: (sceneId: string) => void;
  onPatchElement?: (elementId: string, patch: Record<string, unknown>) => void;
  onSplitElement?: (elementId: string, splitFrame: number) => void;
  onUpdateSceneDuration?: (sceneId: string, frames: number) => void;
  onAddScene?: () => void;
  onDeleteScene?: (sceneId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

// Preset color palette for video/audio element types
const TYPE_COLORS: Record<string, string> = {
  video: "#2b5c8f",  // Deep Blue
  image: "#2d7a6e",  // Teal
  text: "#7c4dff",   // Purple / Violet
  shape: "#d97706",  // Amber
  custom: "#059669", // Emerald
  audio: "#0284c7",  // Sky Blue
  scene: "#1e293b",  // Slate
};

export const NLETimelinePanel: React.FC<NLETimelinePanelProps> = ({
  composition,
  playerRef,
  selectedSceneId,
  selectedElementId,
  soloSceneId,
  onSelectScene,
  onSelectElement,
  onToggleSolo,
  onPatchElement,
  onSplitElement,
  onUpdateSceneDuration,
  onAddScene,
  onDeleteScene,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  // Timeline State
  const [zoomScale, setZoomScale] = useState(1.8); // pixels per frame
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [isRippleEdit, setIsRippleEdit] = useState(false);
  const [activeTool, setActiveTool] = useState<"select" | "razor">("select");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [trackStates, setTrackStates] = useState<Record<string, Partial<TrackConfig>>>({});

  const trackHeight = 44;
  const totalFrames = Math.max(150, totalDurationInFrames(composition));
  const timelineContentRef = useRef<HTMLDivElement>(null);

  // Sync state & events with Remotion Player
  useEffect(() => {
    const player = playerRef?.current;
    if (!player) return;

    const handleFrameUpdate = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    player.addEventListener("frameupdate", handleFrameUpdate);
    player.addEventListener("play", handlePlay);
    player.addEventListener("pause", handlePause);

    return () => {
      player.removeEventListener("frameupdate", handleFrameUpdate);
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("pause", handlePause);
    };
  }, [playerRef]);

  // Fallback playback timer if playerRef is not present
  useEffect(() => {
    if (playerRef?.current) return;
    let animId: number;
    if (isPlaying) {
      let lastTime = performance.now();
      const loop = (now: number) => {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        setCurrentFrame((prev) => {
          const next = prev + dt * composition.fps;
          if (next >= totalFrames) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, composition.fps, totalFrames, playerRef]);

  // Construct Tracks: V3, V2, V1, A1, A2
  const tracks: TrackConfig[] = useMemo(() => {
    return [
      { id: "v3", name: "V3", type: "video", index: 0, ...trackStates["v3"] },
      { id: "v2", name: "V2", type: "video", index: 1, ...trackStates["v2"] },
      { id: "v1", name: "V1", type: "video", index: 2, ...trackStates["v1"] },
      { id: "a1", name: "A1", type: "audio", index: 3, ...trackStates["a1"] },
      { id: "a2", name: "A2", type: "audio", index: 4, ...trackStates["a2"] },
    ];
  }, [trackStates]);

  // Map Composition Scenes & Elements onto Timeline Clips across tracks
  const clips: TimelineClipData[] = useMemo(() => {
    const list: TimelineClipData[] = [];
    let currentSceneStart = 0;

    composition.scenes.forEach((scene) => {
      // Add main scene block on Track V1 or based on layout
      list.push({
        id: scene.id,
        sceneId: scene.id,
        name: scene.name,
        type: "scene",
        startFrame: currentSceneStart,
        durationInFrames: scene.durationInFrames,
        trackIndex: 2, // V1
        color: scene.backgroundColor !== "#0b0b0f" ? scene.backgroundColor : TYPE_COLORS.scene,
        transitionInType: scene.transitionIn?.type,
        locked: scene.locked,
      });

      // Add elements in scene to tracks V2, V3, A1 based on element zIndex & type
      scene.elements.forEach((el) => {
        let trackIdx = 1; // Default V2
        if (el.type === "audio") {
          trackIdx = 3; // A1
        } else if (el.zIndex >= 2) {
          trackIdx = 0; // V3
        } else if (el.zIndex === 1) {
          trackIdx = 1; // V2
        } else {
          trackIdx = 2; // V1
        }

        list.push({
          id: el.id,
          sceneId: scene.id,
          elementId: el.id,
          name: el.name,
          type: el.type,
          startFrame: currentSceneStart + el.startFrame,
          durationInFrames: el.durationInFrames,
          trackIndex: trackIdx,
          color: TYPE_COLORS[el.type] || TYPE_COLORS.text,
          locked: el.locked,
          hidden: el.hidden,
        });
      });

      currentSceneStart += scene.durationInFrames;
    });

    // Add Global Audio elements to A2 track
    composition.globalAudio.forEach((audio, i) => {
      list.push({
        id: audio.id || `gaudio-${i}`,
        sceneId: composition.scenes[0]?.id || "main",
        elementId: audio.id,
        name: audio.name || "Background Music",
        type: "audio",
        startFrame: audio.startFrame,
        durationInFrames: audio.durationInFrames,
        trackIndex: 4, // A2
        color: TYPE_COLORS.audio,
      });
    });

    return list;
  }, [composition]);

  // Track state handlers
  const handleToggleLock = (trackId: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], locked: !prev[trackId]?.locked },
    }));
  };

  const handleToggleMute = (trackId: string) => {
    const isMuted = !trackStates[trackId]?.muted;
    setTrackStates((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], muted: isMuted },
    }));

    const trackIndexMap: Record<string, number> = {
      v3: 0,
      v2: 1,
      v1: 2,
      a1: 3,
      a2: 4,
    };
    const targetIdx = trackIndexMap[trackId];
    if (targetIdx !== undefined) {
      clips
        .filter((c) => c.trackIndex === targetIdx && c.elementId)
        .forEach((c) => {
          if (c.elementId) {
            onPatchElement?.(c.elementId, { muted: isMuted });
          }
        });
    }
  };

  const handleToggleSolo = (trackId: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], solo: !prev[trackId]?.solo },
    }));
  };

  const handleToggleVisible = (trackId: string) => {
    const isVisible = !(trackStates[trackId]?.visible ?? true);
    setTrackStates((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], visible: isVisible },
    }));

    const trackIndexMap: Record<string, number> = {
      v3: 0,
      v2: 1,
      v1: 2,
      a1: 3,
      a2: 4,
    };
    const targetIdx = trackIndexMap[trackId];
    if (targetIdx !== undefined) {
      clips
        .filter((c) => c.trackIndex === targetIdx && c.elementId)
        .forEach((c) => {
          if (c.elementId) {
            onPatchElement?.(c.elementId, { hidden: !isVisible });
          }
        });
    }
  };

  const handleToggleTarget = (trackId: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], targeted: !prev[trackId]?.targeted },
    }));
  };

  // Split element at current playhead position
  const handleSplitAtPlayhead = () => {
    if (!onSplitElement) return;

    if (selectedElementId) {
      const selectedClip = clips.find((c) => c.elementId === selectedElementId);
      if (selectedClip && selectedClip.elementId) {
        onSplitElement(selectedClip.elementId, Math.round(currentFrame));
        return;
      }
    }

    const clipAtPlayhead = clips.find(
      (c) =>
        c.elementId &&
        currentFrame >= c.startFrame &&
        currentFrame <= c.startFrame + c.durationInFrames,
    );
    if (clipAtPlayhead?.elementId) {
      onSplitElement(clipAtPlayhead.elementId, Math.round(currentFrame));
    }
  };

  // Selection & Razor Cut handler
  const handleSelectClip = (clipId: string, e: React.MouseEvent) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    if (activeTool === "razor") {
      if (clip.elementId && onSplitElement) {
        const targetElement = e.currentTarget as HTMLElement;
        const rect = targetElement.getBoundingClientRect();
        const clickXOnClip = e.clientX - rect.left;
        const frameOffset = Math.round(clickXOnClip / zoomScale);
        const splitFrame = Math.max(clip.startFrame + 1, clip.startFrame + frameOffset);
        onSplitElement(clip.elementId, splitFrame);
      }
      return;
    }

    if (e.shiftKey) {
      setSelectedClipIds((prev) =>
        prev.includes(clipId) ? prev.filter((id) => id !== clipId) : [...prev, clipId],
      );
    } else {
      setSelectedClipIds([clipId]);
    }

    if (clip.type === "scene") {
      onSelectScene(clip.sceneId);
      onSelectElement(null);
    } else if (clip.elementId) {
      onSelectScene(clip.sceneId);
      onSelectElement(clip.elementId);
    }
  };

  // Trimming Left Edge (Adjust Start Frame)
  const handleTrimLeft = (clipId: string, targetStartFrame: number) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    if (clip.elementId && onPatchElement) {
      const endFrame = clip.startFrame + clip.durationInFrames;
      const newStart = Math.max(0, Math.min(endFrame - 5, targetStartFrame));
      const newDur = endFrame - newStart;
      onPatchElement(clip.elementId, { startFrame: newStart, durationInFrames: newDur });
    }
  };

  // Trimming Right Edge (Adjust Duration)
  const handleTrimRight = (clipId: string, targetDuration: number) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    if (clip.type === "scene") {
      const newDur = Math.max(15, targetDuration);
      onUpdateSceneDuration?.(clip.sceneId, newDur);
    } else if (clip.elementId && onPatchElement) {
      const newDur = Math.max(5, targetDuration);
      onPatchElement(clip.elementId, { durationInFrames: newDur });
    }
  };

  // Move Clip Position
  const handleMoveClip = (clipId: string, targetStartFrame: number) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    let targetFrames = Math.max(0, targetStartFrame);

    // Snapping logic
    if (isSnapEnabled) {
      const snapThresholdFrames = Math.round(8 / zoomScale);
      if (Math.abs(targetFrames - currentFrame) < snapThresholdFrames) {
        targetFrames = Math.round(currentFrame);
      }
      if (Math.abs(targetFrames) < snapThresholdFrames) {
        targetFrames = 0;
      }
    }

    if (clip.elementId && onPatchElement) {
      onPatchElement(clip.elementId, { startFrame: targetFrames });
    }
  };

  const timelineWidth = Math.max(800, totalFrames * zoomScale);
  const playheadX = currentFrame * zoomScale;

  return (
    <div className="panel nle-timeline-panel">
      {/* NLE Toolbar */}
      <div className="nle-toolbar">
        <div className="toolbar-left">
          {/* Tool Selector */}
          <div className="tool-group">
            <button
              className={`tool-btn ${activeTool === "select" ? "active" : ""}`}
              title="Selection Tool (V)"
              onClick={() => setActiveTool("select")}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 2h1v7L8 5.5V9l4-4-4-4v3.5L3 1H2V2z"/></svg>
            </button>
            <button
              className={`tool-btn ${activeTool === "razor" ? "active" : ""}`}
              title="Razor Cut Tool (C)"
              onClick={() => setActiveTool("razor")}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M2 10.5c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm6-7c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zM4.5 9l8-8M9.5 9l-8-8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
              Razor
            </button>
            <button
              className="tool-btn"
              title="Split Element at Playhead (S)"
              onClick={handleSplitAtPlayhead}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="6" width="5" height="2" rx="1"/><rect x="8" y="6" width="5" height="2" rx="1"/><line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Split
            </button>
          </div>

          {/* Snapping & Ripple Edit */}
          <div className="tool-group">
            <button
              className={`tool-btn ${isSnapEnabled ? "active" : ""}`}
              title="Toggle Snapping (S)"
              onClick={() => setIsSnapEnabled(!isSnapEnabled)}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1v4M7 9v4M1 7h4M9 7h4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>
              Snap
            </button>
            <button
              className={`tool-btn ${isRippleEdit ? "active" : ""}`}
              title="Ripple Edit Mode"
              onClick={() => setIsRippleEdit(!isRippleEdit)}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 9c1-2 2-2 3 0s2 2 3 0 2-2 3 0"/><path d="M1 5c1-2 2-2 3 0s2 2 3 0 2-2 3 0"/></svg>
              Ripple
            </button>
          </div>

          {/* Playback Transport */}
          <div className="tool-group transport">
            <button
              className="tool-btn"
              title="Step Backward (Left Arrow)"
              onClick={() => {
                const prev = Math.max(0, currentFrame - 1);
                setCurrentFrame(prev);
                playerRef?.current?.seekTo(prev);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="2" height="10" rx="1"/><path d="M5 7L13 2v10L5 7z"/></svg>
            </button>
            <button
              className={`tool-btn play-btn ${isPlaying ? "playing" : ""}`}
              title="Play / Pause (Space)"
              onClick={() => {
                if (playerRef?.current) {
                  if (playerRef.current.isPlaying()) {
                    playerRef.current.pause();
                  } else {
                    playerRef.current.play();
                  }
                } else {
                  setIsPlaying((p) => !p);
                }
              }}
            >
              {isPlaying
                ? <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="4" height="10" rx="1"/><rect x="8" y="2" width="4" height="10" rx="1"/></svg>
                : <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2l10 5-10 5V2z"/></svg>}
            </button>
            <button
              className="tool-btn"
              title="Step Forward (Right Arrow)"
              onClick={() => {
                const next = Math.min(totalFrames, currentFrame + 1);
                setCurrentFrame(next);
                playerRef?.current?.seekTo(next);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><rect x="11" y="2" width="2" height="10" rx="1"/><path d="M9 7L1 2v10L9 7z"/></svg>
            </button>
          </div>

          {/* Timecode Display */}
          <div className="nle-timecode-badge">
            <span className="tc-label">TIME</span>
            <span className="tc-value">{formatTimecode(currentFrame, composition.fps)}</span>
          </div>
        </div>

        <div className="toolbar-right">
          {/* Zoom Slider */}
          <div className="zoom-controls">
            <button
              className="icon-btn sm"
              title="Zoom Out"
              onClick={() => setZoomScale((z) => Math.max(0.4, z - 0.4))}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="4.5" cy="4.5" r="3.5"/><line x1="7.5" y1="7.5" x2="10" y2="10"/><line x1="3" y1="4.5" x2="6" y2="4.5"/></svg>
            </button>
            <input
              type="range"
              min={0.4}
              max={6.0}
              step={0.1}
              value={zoomScale}
              onChange={(e) => setZoomScale(Number(e.target.value))}
              className="zoom-slider"
            />
            <button
              className="icon-btn sm"
              title="Zoom In"
              onClick={() => setZoomScale((z) => Math.min(6.0, z + 0.4))}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="4.5" cy="4.5" r="3.5"/><line x1="7.5" y1="7.5" x2="10" y2="10"/><line x1="3" y1="4.5" x2="6" y2="4.5"/><line x1="4.5" y1="3" x2="4.5" y2="6"/></svg>
            </button>
          </div>

          {/* Add Scene & Undo / Redo */}
          {onUndo && (
            <button
              className="icon-btn sm"
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7a5 5 0 105-5H4"/><path d="M2 4V7h3"/></svg>
            </button>
          )}
          {onRedo && (
            <button
              className="icon-btn sm"
              title="Redo (Ctrl+Y)"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7a5 5 0 10-5-5h3"/><path d="M12 4V7H9"/></svg>
            </button>
          )}
          {onAddScene && (
            <button className="primary-btn sm" onClick={onAddScene}>
              + Add Scene
            </button>
          )}
        </div>
      </div>

      {/* Main NLE Body: Headers on Left + Track Canvas on Right */}
      <div className="nle-timeline-body">
        {/* Track Headers Column */}
        <TrackHeader
          tracks={tracks}
          onToggleLock={handleToggleLock}
          onToggleMute={handleToggleMute}
          onToggleSolo={handleToggleSolo}
          onToggleVisible={handleToggleVisible}
          onToggleTarget={handleToggleTarget}
        />

        {/* Scrollable Tracks Canvas */}
        <div className="nle-tracks-scroll-area" ref={timelineContentRef}>
          {/* Timecode Ruler at Top */}
          <TimeRuler
            totalFrames={totalFrames}
            fps={composition.fps}
            zoomScale={zoomScale}
            currentFrame={currentFrame}
            onSeek={(f) => {
              setCurrentFrame(f);
              playerRef?.current?.seekTo(f);
            }}
          />

          {/* Tracks Canvas */}
          <div className="nle-tracks-canvas" style={{ width: timelineWidth }}>
            {/* Grid Track Lines */}
            {tracks.map((track) => (
              <div key={track.id} className="nle-track-lane" style={{ height: trackHeight }}>
                <div className="track-lane-line" />
              </div>
            ))}

            {/* Render Clips onto Tracks */}
            {clips.map((clip) => {
              const isSelected = selectedClipIds.includes(clip.id);
              const topPx = 28 + clip.trackIndex * trackHeight + 3; // 28px for ruler header

              return (
                <div key={clip.id} style={{ position: "absolute", top: topPx, left: 0, right: 0 }}>
                  <ClipBlock
                    clip={clip}
                    zoomScale={zoomScale}
                    trackHeight={trackHeight}
                    isSelected={isSelected}
                    fps={composition.fps}
                    onSelect={handleSelectClip}
                    onTrimLeft={handleTrimLeft}
                    onTrimRight={handleTrimRight}
                    onMoveClip={handleMoveClip}
                  />
                </div>
              );
            })}

            {/* Interactive Blue Playhead Line */}
            <div className="nle-playhead-line" style={{ left: playheadX }} />
          </div>
        </div>
      </div>
    </div>
  );
};
