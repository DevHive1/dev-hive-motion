import React, { useMemo, useRef, useState } from "react";
import type { Composition } from "../schema/scene";
import { MentionInput, type MentionItem } from "./components/chat/MentionInput";

export type ChatEvent =
  | { type: "user_prompt"; text: string; imageUrls?: string[] }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "tool_error"; name: string; error: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

interface ChatPanelProps {
  log: ChatEvent[];
  prompt: string;
  onPromptChange: (value: string) => void;
  busy: boolean;
  onSend: (mentions?: MentionItem[], imageUrls?: string[]) => void;
  onClear: () => void;
  composition: Composition;
}

/**
 * Render an item (args, result, error) with smart truncation. Long JSON
 * is collapsed to the first ~2 lines with a "show more" toggle. Booleans
 * and short strings stay inline. Numbers are passed through.
 */
function renderValue(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="json-null">{String(value)}</span>;
  }
  if (typeof value === "string") {
    if (value.length > 200) {
      return (
        <span className="json-string json-long" title={value}>
          "{value.slice(0, 200)}…"
        </span>
      );
    }
    return <span className="json-string">"{value}"</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="json-number">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-bracket">[]</span>;
    if (depth >= 1) {
      return <span className="json-bracket">Array({value.length})</span>;
    }
    return (
      <span className="json-bracket">
        [
        {value.slice(0, 3).map((v, i) => (
          <React.Fragment key={i}>
            <span className="json-indent">{renderValue(v, depth + 1)}</span>
            {i < Math.min(2, value.length - 1) ? "," : null}
          </React.Fragment>
        ))}
        {value.length > 3 && <span className="json-ellipsis">, … +{value.length - 3} more</span>}
        ]
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="json-bracket">{"{}"}</span>;
    if (depth >= 1) {
      return <span className="json-bracket">{"{…}"}</span>;
    }
    // Show up to 4 keys inline; collapse the rest. Highlight the ones that
    // are typically the "what matters" - id, ok, error, message, etc.
    const visible = entries.slice(0, 4);
    return (
      <span className="json-bracket">
        {"{"}
        {visible.map(([k, v], i) => (
          <span key={k} className="json-entry">
            <span className="json-key">{k}</span>
            <span className="json-colon">: </span>
            {renderValue(v, depth + 1)}
            {i < visible.length - 1 ? "," : null}
          </span>
        ))}
        {entries.length > 4 && (
          <span className="json-ellipsis">, … +{entries.length - 4} more</span>
        )}
        {"}"}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

/**
 * Group consecutive tool_call + tool_result/tool_error into a single
 * "Operation" card. User prompts, thinking, final, and error events stay
 * standalone. This is the key readability improvement: instead of 4
 * separate rows for "→ add_text_element(...)", "✓ add_text_element → {...}",
 * "→ add_animation(...)", "✓ add_animation → {...}", you see one card
 * with the operation, its args, and its outcome.
 */
type ChatItem =
  | { kind: "prompt"; text: string; imageUrls?: string[]; id: string }
  | { kind: "thinking"; text: string; id: string }
  | { kind: "operation"; name: string; args: Record<string, unknown>; outcome: { ok: boolean; payload: unknown; error?: string } | null; id: string; runningId?: string }
  | { kind: "final"; text: string; id: string }
  | { kind: "error"; message: string; id: string };

function groupEvents(events: ChatEvent[]): ChatItem[] {
  const out: ChatItem[] = [];
  let pendingOp: { name: string; args: Record<string, unknown>; id: string; runningId: string } | null = null;
  let counter = 0;
  const nextId = () => `evt-${counter++}`;
  for (const ev of events) {
    if (ev.type === "tool_call") {
      // If we already had a pending op, close it as "no result yet"
      if (pendingOp) {
        out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: null, id: pendingOp.id, runningId: pendingOp.runningId });
      }
      const id = nextId();
      pendingOp = { name: ev.name, args: ev.args, id, runningId: id };
    } else if (ev.type === "tool_result" && pendingOp && pendingOp.name === ev.name) {
      out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: { ok: true, payload: ev.result }, id: pendingOp.id });
      pendingOp = null;
    } else if (ev.type === "tool_error" && pendingOp && pendingOp.name === ev.name) {
      out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: { ok: false, payload: null, error: ev.error }, id: pendingOp.id });
      pendingOp = null;
    } else if (ev.type === "tool_result" || ev.type === "tool_error") {
      // A result/error with no matching call (e.g. after retry). Close any
      // pending op and surface the orphan.
      if (pendingOp) {
        out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: null, id: pendingOp.id, runningId: pendingOp.runningId });
        pendingOp = null;
      }
      if (ev.type === "tool_error") {
        out.push({ kind: "error", message: `${ev.name} failed: ${ev.error}`, id: nextId() });
      }
    } else {
      if (pendingOp) {
        out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: null, id: pendingOp.id, runningId: pendingOp.runningId });
        pendingOp = null;
      }
      if (ev.type === "user_prompt") out.push({ kind: "prompt", text: ev.text, imageUrls: ev.imageUrls, id: nextId() });
      else if (ev.type === "thinking") out.push({ kind: "thinking", text: ev.text, id: nextId() });
      else if (ev.type === "final") out.push({ kind: "final", text: ev.text, id: nextId() });
      else if (ev.type === "error") out.push({ kind: "error", message: ev.message, id: nextId() });
    }
  }
  // If busy, the last op is still running
  if (pendingOp) {
    out.push({ kind: "operation", name: pendingOp.name, args: pendingOp.args, outcome: null, id: pendingOp.id, runningId: pendingOp.runningId });
  }
  return out;
}

type FilterMode = "all" | "ops" | "errors" | "thinking";

const QUICK_START_PROMPTS = [
  "Add an intro scene with a bold title that fades in",
  "Set project orientation to portrait 1080x1920",
  "Animate all elements in scene 1 with fade_up",
  "Apply fade transitions between all scenes",
];

export const ChatPanel: React.FC<ChatPanelProps> = ({
  log,
  prompt,
  onPromptChange,
  busy,
  onSend,
  onClear,
  composition,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [showReasoning, setShowReasoning] = useState(true);
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());

  const items = useMemo(() => groupEvents(log), [log]);

  const visibleItems = useMemo(() => {
    return items.filter((it) => {
      if (filter === "all") return true;
      if (filter === "ops") return it.kind === "operation";
      if (filter === "errors") return it.kind === "error" || (it.kind === "operation" && it.outcome && !it.outcome.ok);
      if (filter === "thinking") return it.kind === "thinking";
      return true;
    }).map((it) => {
      // Hide thinking content if showReasoning is off
      if (!showReasoning && it.kind === "thinking") return null;
      return it;
    }).filter(Boolean) as ChatItem[];
  }, [items, filter, showReasoning]);

  // Counts for filter chips
  const counts = useMemo(() => {
    let ops = 0, errors = 0, thinking = 0;
    for (const it of items) {
      if (it.kind === "operation") ops++;
      if (it.kind === "error") errors++;
      if (it.kind === "operation" && it.outcome && !it.outcome.ok) errors++;
      if (it.kind === "thinking") thinking++;
    }
    return { ops, errors, thinking };
  }, [items]);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, busy]);

  const toggleOp = (id: string) => {
    setExpandedOps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="chat">
      {items.length > 0 && (
        <div className="chat-header">
          <div className="chat-filter-chips" role="tablist" aria-label="Filter log">
            <button
              role="tab"
              aria-selected={filter === "all"}
              className={`chat-filter-chip ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              role="tab"
              aria-selected={filter === "ops"}
              className={`chat-filter-chip ${filter === "ops" ? "active" : ""}`}
              onClick={() => setFilter("ops")}
            >
              Operations {counts.ops > 0 && <span className="chat-filter-count">{counts.ops}</span>}
            </button>
            <button
              role="tab"
              aria-selected={filter === "errors"}
              className={`chat-filter-chip errors ${filter === "errors" ? "active" : ""}`}
              onClick={() => setFilter("errors")}
            >
              Errors {counts.errors > 0 && <span className="chat-filter-count error">{counts.errors}</span>}
            </button>
            <button
              role="tab"
              aria-selected={filter === "thinking"}
              className={`chat-filter-chip ${filter === "thinking" ? "active" : ""}`}
              onClick={() => setFilter("thinking")}
            >
              Reasoning {counts.thinking > 0 && <span className="chat-filter-count">{counts.thinking}</span>}
            </button>
          </div>
          <label className="chat-toggle-reasoning" title="Show or hide agent reasoning">
            <input
              type="checkbox"
              checked={showReasoning}
              onChange={(e) => setShowReasoning(e.target.checked)}
            />
            <span>show reasoning</span>
          </label>
          <button className="chat-clear-btn" onClick={onClear} disabled={busy}>
            Clear chat
          </button>
        </div>
      )}

      <div className="chat-log">
        {items.length === 0 && (
          <div className="empty-state" style={{ margin: "12px" }}>
            <div className="empty-state-icon">✳</div>
            <div className="empty-state-text">
              Tell the agent what to build. Use @ to mention elements/scenes or attach images.
            </div>
            <div className="quick-start">
              {QUICK_START_PROMPTS.map((p) => (
                <button key={p} className="chip" onClick={() => onPromptChange(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleItems.map((item) => {
          if (item.kind === "prompt") {
            return (
              <div key={item.id} className="chat-item chat-item-prompt">
                <div className="chat-item-label">You</div>
                <div className="chat-item-body">{item.text}</div>
                {item.imageUrls && item.imageUrls.length > 0 && (
                  <div className="attached-images-strip">
                    {item.imageUrls.map((url, imgIdx) => (
                      <img key={imgIdx} src={url} alt="User attachment" className="chat-attached-img" />
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (item.kind === "thinking") {
            return (
              <details key={item.id} className="chat-item chat-item-thinking" open={showReasoning}>
                <summary>
                  <span className="chat-item-label">Reasoning</span>
                  <span className="chat-item-summary-text">{item.text.slice(0, 120)}{item.text.length > 120 ? "…" : ""}</span>
                </summary>
                <div className="chat-item-body">{item.text}</div>
              </details>
            );
          }
          if (item.kind === "operation") {
            const expanded = expandedOps.has(item.id);
            const isRunning = item.outcome === null && busy;
            const isError = item.outcome !== null && !item.outcome.ok;
            const isOk = item.outcome !== null && item.outcome.ok;
            const status = isRunning ? "running" : isError ? "error" : isOk ? "ok" : "ok";
            return (
              <div key={item.id} className={`chat-item chat-item-operation chat-item-op-${status}`}>
                <button
                  className="chat-item-op-header"
                  onClick={() => toggleOp(item.id)}
                  aria-expanded={expanded}
                >
                  <span className={`chat-item-op-status status-${status}`}>
                    {isRunning ? <span className="chat-item-spinner" aria-hidden="true" /> : isError ? "✗" : "✓"}
                  </span>
                  <span className="chat-item-op-name">{item.name}</span>
                  {item.outcome && item.outcome.ok && (
                    <span className="chat-item-op-summary">{summarizeResult(item.outcome.payload)}</span>
                  )}
                  {item.outcome && !item.outcome.ok && (
                    <span className="chat-item-op-summary error">{item.outcome.error}</span>
                  )}
                  <span className={`chat-item-op-caret ${expanded ? "expanded" : ""}`}>▸</span>
                </button>
                {expanded && (
                  <div className="chat-item-op-body">
                    <div className="chat-item-op-section">
                      <div className="chat-item-op-section-label">args</div>
                      <pre className="chat-item-op-json">{renderValue(item.args)}</pre>
                    </div>
                    {item.outcome && item.outcome.ok && (
                      <div className="chat-item-op-section">
                        <div className="chat-item-op-section-label">result</div>
                        <pre className="chat-item-op-json">{renderValue(item.outcome.payload)}</pre>
                      </div>
                    )}
                    {item.outcome && !item.outcome.ok && (
                      <div className="chat-item-op-section">
                        <div className="chat-item-op-section-label">error</div>
                        <pre className="chat-item-op-json error">{item.outcome.error}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }
          if (item.kind === "final") {
            return (
              <div key={item.id} className="chat-item chat-item-final">
                <div className="chat-item-label">Answer</div>
                <div className="chat-item-body">{item.text}</div>
              </div>
            );
          }
          // error
          return (
            <div key={item.id} className="chat-item chat-item-error">
              <div className="chat-item-label">Error</div>
              <div className="chat-item-body">{item.message}</div>
            </div>
          );
        })}

        {busy && items.length > 0 && items[items.length - 1]?.kind !== "operation" && (
          <div className="chat-item chat-item-thinking live">
            <span className="chat-item-spinner" />
            <span className="chat-item-label">Agent is working…</span>
          </div>
        )}

        <div ref={logEndRef} />
      </div>

      <MentionInput
        value={prompt}
        onChange={onPromptChange}
        onSend={(mentions, imageUrls) => onSend(mentions, imageUrls)}
        composition={composition}
        busy={busy}
      />
    </div>
  );
};

/**
 * One-line summary of a tool result, used in the operation header so
 * you can scan the log without expanding every card. e.g.
 *   { ok: true, elementId: "el-abc" } -> "el-abc"
 *   { sceneId: "scene-1" } -> "scene-1"
 */
function summarizeResult(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // Prefer the "what just got created" id.
    for (const key of ["elementId", "sceneId", "animationId", "url", "id"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    // Fall back to the first string field.
    for (const v of Object.values(obj)) {
      if (typeof v === "string") return v;
    }
    if ("ok" in obj) {
      const rest = Object.entries(obj)
        .filter(([k]) => k !== "ok")
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${typeof v === "string" || typeof v === "number" ? v : "…"}`)
        .join(", ");
      return rest || (obj.ok ? "ok" : "");
    }
    return "…";
  }
  return String(payload);
}
