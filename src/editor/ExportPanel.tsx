import React, { useState } from "react";

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

  const startRender = async () => {
    setPhase("bundling");
    setProgress(0);
    setError(null);
    setFileName(null);

    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    if (reader) {
      // eslint-disable-next-line no-constant-condition
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
            }
            if (event.type === "error") {
              setPhase("error");
              setError(event.message ?? "Render failed.");
            }
          } catch {
            // ignore malformed/empty keepalive chunks
          }
        }
      }
    }
  };

  const busy = phase === "bundling" || phase === "rendering";

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-panel-header">
          <span>Export</span>
          <button className="export-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="export-format-row">
          <button
            className={`export-format-btn ${format === "mp4" ? "active" : ""}`}
            onClick={() => setFormat("mp4")}
            disabled={busy}
          >
            MP4
          </button>
          <button
            className={`export-format-btn ${format === "gif" ? "active" : ""}`}
            onClick={() => setFormat("gif")}
            disabled={busy}
          >
            GIF
          </button>
        </div>

        {phase === "idle" && (
          <button className="export-start-btn" onClick={startRender}>
            Render {format.toUpperCase()}
          </button>
        )}

        {phase === "bundling" && (
          <div className="export-status">Preparing renderer (first render is slower)…</div>
        )}

        {phase === "rendering" && (
          <div className="export-progress">
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="export-status">{Math.round(progress * 100)}%</div>
          </div>
        )}

        {phase === "done" && fileName && (
          <div className="export-done">
            <div className="export-status">Done.</div>
            <a className="export-download-btn" href={`/renders/${fileName}`} download>
              Download {format.toUpperCase()}
            </a>
            <button className="export-start-btn secondary" onClick={startRender}>
              Render again
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="export-status error">
            {error}
            <button className="export-start-btn secondary" onClick={startRender}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
