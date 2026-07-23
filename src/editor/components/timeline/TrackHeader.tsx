import React from "react";

export interface TrackConfig {
  id: string;
  name: string;
  type: "video" | "audio";
  index: number;
  locked?: boolean;
  muted?: boolean;
  solo?: boolean;
  visible?: boolean;
  targeted?: boolean;
}

interface TrackHeaderProps {
  tracks: TrackConfig[];
  onToggleLock: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleVisible: (trackId: string) => void;
  onToggleTarget: (trackId: string) => void;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  tracks,
  onToggleLock,
  onToggleMute,
  onToggleSolo,
  onToggleVisible,
  onToggleTarget,
}) => {
  return (
    <div className="nle-track-headers-column">
      <div className="nle-track-header-top-corner">
        <span className="nle-track-corner-label">TRACKS</span>
      </div>

      <div className="nle-track-headers-list">
        {tracks.map((track) => {
          const isVideo = track.type === "video";
          const isLocked = !!track.locked;
          const isMuted = !!track.muted;
          const isSolo = !!track.solo;
          const isVisible = track.visible !== false;
          const isTargeted = !!track.targeted;

          return (
            <div
              key={track.id}
              className={`nle-track-header-item ${isVideo ? "video-track" : "audio-track"} ${
                isTargeted ? "targeted" : ""
              }`}
            >
              <div className="track-identity">
                <button
                  className={`track-target-btn ${isTargeted ? "active" : ""}`}
                  title={isTargeted ? "Target Track (Active)" : "Target Track"}
                  onClick={() => onToggleTarget(track.id)}
                >
                  {track.name}
                </button>
              </div>

              <div className="track-controls">
                {/* Lock Toggle */}
                <button
                  className={`track-btn ${isLocked ? "active locked" : ""}`}
                  title={isLocked ? "Unlock Track" : "Lock Track"}
                  onClick={() => onToggleLock(track.id)}
                >
                  {isLocked ? "🔒" : "🔓"}
                </button>

                {/* Visibility Toggle (for Video) */}
                {isVideo && (
                  <button
                    className={`track-btn ${!isVisible ? "active hidden-eye" : ""}`}
                    title={isVisible ? "Toggle Output (Visible)" : "Toggle Output (Hidden)"}
                    onClick={() => onToggleVisible(track.id)}
                  >
                    {isVisible ? "👁️" : "🙈"}
                  </button>
                )}

                {/* Mute Toggle (for Audio or Video with Audio) */}
                <button
                  className={`track-btn ${isMuted ? "active muted" : ""}`}
                  title={isMuted ? "Unmute Track (M)" : "Mute Track (M)"}
                  onClick={() => onToggleMute(track.id)}
                >
                  {isMuted ? "🔇" : "🔊"}
                </button>

                {/* Solo Toggle */}
                <button
                  className={`track-btn solo ${isSolo ? "active" : ""}`}
                  title={isSolo ? "Solo Track (S)" : "Solo Track (S)"}
                  onClick={() => onToggleSolo(track.id)}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
