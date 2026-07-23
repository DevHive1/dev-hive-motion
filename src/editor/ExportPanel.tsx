import React, { useState, useRef } from "react";

type RenderFormat = "mp4" | "gif";
type RenderPhase = "idle" | "bundling" | "rendering" | "done" | "error";

interface RenderProgressEvent {
  type: "bundling" | "rendering" | "done" | "error";
  progress?: number;
  fileName?: string;
  message?: string;
}

export const ExportPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [format, setFormat] = useState<RenderFormat>("mp4");
  const [phase, setPhase] = useState<RenderPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 500);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const estimateRemaining = (prog: number): string => {
    if (prog <= 0.01 || elapsedSec < 3) return "";
    const totalEst = elapsedSec / prog;
    const remaining = Math.max(0, Math.round(totalEst - elapsedSec));
    if (remaining < 5) return "almost done…";
    if (remaining < 60) return `~${remaining}s remaining`;
    return `~${Math.ceil(remaining / 60)}m remaining`;
  };

  const startRender = async () => {
    setPhase("bundling");
    setProgress(0);
    setError(null);
    setFileName(null);
    setElapsedSec(0);
    startTimer();

    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice("data: ".length)) as RenderProgressEvent;
            if (event.type === "bundling") setPhase("bundling");
            if (event.type === "rendering") {
              setPhase("rendering");
              setProgress(event.progress ?? 0);
            }
            if (event.type === "done") {
              setPhase("done");
              setFileName(event.fileName ?? null);
              stopTimer();
            }
            if (event.type === "error") {
              setPhase("error");
              setError(event.message ?? "Render failed.");
              stopTimer();
            }
          } catch {
            // ignore malformed/empty keepalive chunks
          }
        }
      }
    }
  };

  const busy = phase === "bundling" || phase === "rendering";
  const pct = Math.round(progress * 100);

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-panel-header">
          <div className="export-panel-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 11L4 7h2.5V2h3v5H12L8 11z" />
              <rect x="2" y="12" width="12" height="1.5" rx="0.75" />
            </svg>
            Export Video
          </div>
          <button className="export-close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Format picker */}
        <div className="export-format-row">
          {(["mp4", "gif"] as RenderFormat[]).map((f) => (
            <button
              key={f}
              className={`export-format-btn ${format === f ? "active" : ""}`}
              onClick={() => setFormat(f)}
              disabled={busy}
            >
              {f.toUpperCase()}
              {f === "gif" && <span className="export-format-note"> (smaller, 540p)</span>}
            </button>
          ))}
        </div>

        {/* States */}
        {phase === "idle" && (
          <button className="export-start-btn" onClick={startRender}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 2l9 5-9 5V2z" />
            </svg>
            Render {format.toUpperCase()}
          </button>
        )}

        {phase === "bundling" && (
          <div className="export-bundling">
            <div className="export-spinner" />
            <div className="export-status-text">
              Preparing renderer…
              <span className="export-elapsed">{elapsedSec}s</span>
            </div>
            <div className="export-hint">First render takes longer while the bundler warms up.</div>
          </div>
        )}

        {phase === "rendering" && (
          <div className="export-progress-wrap">
            <div className="export-progress-header">
              <span className="export-status-text">Rendering frames…</span>
              <span className="export-elapsed">{elapsedSec}s</span>
            </div>
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${pct}%` }}>
                <div className="export-progress-shine" />
              </div>
            </div>
            <div className="export-progress-meta">
              <span className="export-pct">{pct}%</span>
              <span className="export-remaining">{estimateRemaining(progress)}</span>
            </div>
          </div>
        )}

        {phase === "done" && fileName && (
          <div className="export-done">
            <div className="export-done-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="15" stroke="#22c55e" strokeWidth="2" />
                <path d="M9 16l5 5 9-9" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="export-status-text">
              Rendered in {elapsedSec}s
            </div>
            <a className="export-download-btn" href={`/renders/${fileName}`} download>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 10L3 6h2.5V1h3v5H11L7 10z" />
                <rect x="1" y="11" width="12" height="1.5" rx="0.75" />
              </svg>
              Download {format.toUpperCase()}
            </a>
            <button className="export-start-btn secondary" onClick={startRender}>
              Render again
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="export-error">
            <div className="export-error-icon">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="13" stroke="#ef4444" strokeWidth="2" />
                <path d="M14 8v7M14 18v2" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="export-error-msg">{error}</div>
            <button className="export-start-btn secondary" onClick={startRender}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
