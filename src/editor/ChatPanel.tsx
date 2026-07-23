import React, { useRef } from "react";
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

function describeEvent(event: ChatEvent): string {
  switch (event.type) {
    case "user_prompt":
      return event.text;
    case "thinking":
      return event.text;
    case "tool_call":
      return `→ ${event.name}(${JSON.stringify(event.args)})`;
    case "tool_result":
      return `✓ ${event.name} → ${JSON.stringify(event.result)}`;
    case "tool_error":
      return `✗ ${event.name} failed: ${event.error}`;
    case "final":
      return event.text;
    case "error":
      return event.message;
  }
}

const QUICK_START_PROMPTS = [
  "Add an intro scene with a bold title that fades in",
  "Set project orientation to portrait 1080x1920",
  "Animate all elements in scene 1 with fade_up",
  "Apply fade transitions between all scenes",
];

interface ChatPanelProps {
  log: ChatEvent[];
  prompt: string;
  onPromptChange: (value: string) => void;
  busy: boolean;
  onSend: (mentions?: MentionItem[], imageUrls?: string[]) => void;
  onClear: () => void;
  composition: Composition;
}

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

  return (
    <div className="chat">
      {log.length > 0 && (
        <div className="chat-header">
          <span className="chat-title">AI Assistant Log</span>
          <button className="chat-clear-btn" onClick={onClear} disabled={busy}>
            Clear chat
          </button>
        </div>
      )}
      <div className="chat-log">
        {log.length === 0 && (
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
        {log.map((event, i) => (
          <div key={i} className={`chat-event ${event.type}`}>
            <div>{describeEvent(event)}</div>
            {event.type === "user_prompt" && event.imageUrls && event.imageUrls.length > 0 && (
              <div className="attached-images-strip">
                {event.imageUrls.map((url, imgIdx) => (
                  <img key={imgIdx} src={url} alt="User attachment" className="chat-attached-img" />
                ))}
              </div>
            )}
          </div>
        ))}
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
