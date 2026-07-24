import React, { useEffect, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type { Composition, Transition } from "../schema/scene";
import { emptyComposition, totalDurationInFrames } from "../schema/scene";
import { Preview } from "./Preview";
import { NLETimelinePanel } from "./components/timeline/NLETimelinePanel";
import { InspectorPanel } from "./components/inspector/InspectorPanel";
import { ChatPanel, type ChatEvent } from "./ChatPanel";
import { ModelPicker } from "./ModelPicker";
import { ExportPanel } from "./ExportPanel";
import { CanvasOverlay } from "./CanvasOverlay";
import { DevHiveLogo } from "./components/DevHiveLogo";
import { StoryboardPanel } from "./components/StoryboardPanel";
import { useKeyboard } from "./hooks/useKeyboard";
import type { MentionItem } from "./components/chat/MentionInput";

type MobileTab = "timeline" | "elements" | "chat" | "split" | "storyboard";
type BottomTab = "timeline" | "chat" | "split" | "storyboard";

export const App: React.FC = () => {
  const [composition, setComposition] = useState<Composition>(emptyComposition());
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [chatLog, setChatLog] = useState<ChatEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [bottomTab, setBottomTab] = useState<BottomTab>("timeline");
  const [exportOpen, setExportOpen] = useState(false);
  const [soloSceneId, setSoloSceneId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"vanilla" | "dark">("vanilla");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(1);
  const patchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── Fetch composition & chat log on mount ──────────────────────────────────
  useEffect(() => {
    fetch("/api/composition")
      .then((res) => res.json())
      .then((data: Composition) => {
        if (data && Array.isArray(data.scenes)) {
          setComposition(data);
          setSelectedSceneId((prev) => {
            if (prev && data.scenes.some((s) => s.id === prev)) return prev;
            return data.scenes[data.scenes.length - 1]?.id ?? null;
          });
        }
      })
      .catch(() => {});

    fetch("/api/chatlog")
      .then((res) => res.json())
      .then((entries: ChatEvent[]) => setChatLog(entries))
      .catch(() => {});
  }, []);

  // ── WebSocket: real-time composition + collaboration ──────────────────────
  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.port === "5173"
        ? `${window.location.hostname}:4000`
        : window.location.host;
      const ws = new WebSocket(`${protocol}//${wsHost}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "composition") {
            const next: Composition = msg.composition;
            setComposition(next);
            setCanUndo(Boolean(msg.canUndo));
            setCanRedo(Boolean(msg.canRedo));
            setSelectedSceneId((prev) => {
              if (prev && next.scenes.some((s) => s.id === prev)) return prev;
              return next.scenes[next.scenes.length - 1]?.id ?? null;
            });
          }

          if (msg.type === "users") {
            setOnlineUsers(Number(msg.count) || 1);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        // Reconnect after 2s if disconnected
        setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const updateServerComposition = async (next: Composition) => {
    setComposition(next);
    await fetch("/api/composition", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  const handleUndo = async () => {
    try {
      const res = await fetch("/api/composition/undo", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.composition) setComposition(data.composition);
        if (typeof data.canUndo === "boolean") setCanUndo(data.canUndo);
        if (typeof data.canRedo === "boolean") setCanRedo(data.canRedo);
      }
    } catch {
      // ignore
    }
  };

  const handleRedo = async () => {
    try {
      const res = await fetch("/api/composition/redo", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.composition) setComposition(data.composition);
        if (typeof data.canUndo === "boolean") setCanUndo(data.canUndo);
        if (typeof data.canRedo === "boolean") setCanRedo(data.canRedo);
      }
    } catch {
      // ignore
    }
  };

  const patchElement = (elementId: string, patch: Record<string, unknown>) => {
    if (!selectedSceneId) return;

    setComposition((prev) => ({
      ...prev,
      scenes: prev.scenes.map((scene) =>
        scene.id !== selectedSceneId
          ? scene
          : {
              ...scene,
              elements: scene.elements.map((el) =>
                el.id === elementId ? ({ ...el, ...patch } as typeof el) : el,
              ),
            },
      ),
    }));

    if (patchDebounce.current) clearTimeout(patchDebounce.current);
    patchDebounce.current = setTimeout(() => {
      setComposition((current) => {
        fetch("/api/composition", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
        return current;
      });
    }, 250);
  };

  const deleteElement = (elementId: string) => {
    if (!selectedSceneId) return;
    const next: Composition = {
      ...composition,
      scenes: composition.scenes.map((s) =>
        s.id !== selectedSceneId
          ? s
          : { ...s, elements: s.elements.filter((el) => el.id !== elementId) },
      ),
    };
    setSelectedElementId(null);
    updateServerComposition(next);
  };

  const duplicateElement = (elementId: string) => {
    if (!selectedSceneId) return;
    const scene = composition.scenes.find((s) => s.id === selectedSceneId);
    const element = scene?.elements.find((e) => e.id === elementId);
    if (!element || !scene) return;

    const cloned = {
      ...structuredClone(element),
      id: `el-${Date.now().toString(36)}`,
      name: `${element.name} (Copy)`,
      x: Math.min(90, element.x + 4),
      y: Math.min(90, element.y + 4),
    };

    const next: Composition = {
      ...composition,
      scenes: composition.scenes.map((s) =>
        s.id !== selectedSceneId ? s : { ...s, elements: [...s.elements, cloned] },
      ),
    };
    setSelectedElementId(cloned.id);
    updateServerComposition(next);
  };

  const splitElement = (elementId: string, splitFrame: number) => {
    let targetScene = composition.scenes.find((s) => s.elements.some((e) => e.id === elementId));
    if (!targetScene && selectedSceneId) {
      targetScene = composition.scenes.find((s) => s.id === selectedSceneId);
    }
    if (!targetScene) return;

    const element = targetScene.elements.find((e) => e.id === elementId);
    if (!element) return;

    const elementEnd = element.startFrame + element.durationInFrames;
    if (splitFrame <= element.startFrame + 2 || splitFrame >= elementEnd - 2) return;

    const firstPartDuration = splitFrame - element.startFrame;
    const secondPart = {
      ...structuredClone(element),
      id: `el-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      name: `${element.name} (Part 2)`,
      startFrame: splitFrame,
      durationInFrames: elementEnd - splitFrame,
    };

    const sceneIdToUpdate = targetScene.id;
    const next: Composition = {
      ...composition,
      scenes: composition.scenes.map((s) =>
        s.id !== sceneIdToUpdate
          ? s
          : {
              ...s,
              elements: s.elements
                .map((el) =>
                  el.id === elementId ? { ...el, durationInFrames: firstPartDuration } : el,
                )
                .concat(secondPart),
            },
      ),
    };
    setSelectedElementId(secondPart.id);
    updateServerComposition(next);
  };

  const updateSceneTransition = (transition: Transition | undefined) => {
    if (!selectedSceneId) return;
    const next: Composition = {
      ...composition,
      scenes: composition.scenes.map((s) =>
        s.id !== selectedSceneId ? s : { ...s, transitionIn: transition },
      ),
    };
    updateServerComposition(next);
  };

  const addScene = () => {
    const newId = `scene-${Date.now().toString(36)}`;
    const newScene = {
      id: newId,
      name: `Scene ${composition.scenes.length + 1}`,
      durationInFrames: 150,
      backgroundColor: "#0b0b0f",
      elements: [],
      locked: false,
      solo: false,
      collapsed: false,
    };
    const next: Composition = { ...composition, scenes: [...composition.scenes, newScene] };
    setSelectedSceneId(newId);
    updateServerComposition(next);
  };

  const deleteScene = (sceneId: string) => {
    if (composition.scenes.length <= 1) return;
    const next: Composition = {
      ...composition,
      scenes: composition.scenes.filter((s) => s.id !== sceneId),
    };
    if (selectedSceneId === sceneId) {
      setSelectedSceneId(next.scenes[0]?.id ?? null);
    }
    updateServerComposition(next);
  };

  const updateSceneDuration = (sceneId: string, frames: number) => {
    const next: Composition = {
      ...composition,
      scenes: composition.scenes.map((s) =>
        s.id !== sceneId ? s : { ...s, durationInFrames: frames },
      ),
    };
    updateServerComposition(next);
  };

  useKeyboard({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDelete: () => { if (selectedElementId) deleteElement(selectedElementId); },
    onDuplicate: () => { if (selectedElementId) duplicateElement(selectedElementId); },
    onDeselect: () => setSelectedElementId(null),
  });

  const followSceneFromEvent = (event: ChatEvent) => {
    if (event.type === "tool_call" && typeof event.args?.sceneId === "string") {
      setSelectedSceneId(event.args.sceneId);
      return;
    }
    if (
      event.type === "tool_result" &&
      event.result &&
      typeof event.result === "object" &&
      "sceneId" in (event.result as Record<string, unknown>)
    ) {
      const id = (event.result as { sceneId?: unknown }).sceneId;
      if (typeof id === "string") setSelectedSceneId(id);
    }
  };

  const clearChat = async () => {
    await fetch("/api/chatlog", { method: "DELETE" }).catch(() => {});
    setChatLog([]);
  };

  const sendPrompt = async (mentions?: MentionItem[], imageUrls?: string[]) => {
    if (!prompt.trim() || busy) return;
    const currentPrompt = prompt;
    setPrompt("");
    setBusy(true);
    setMobileTab("chat");
    setBottomTab("chat");
    setChatLog((prev) => [...prev, { type: "user_prompt", text: currentPrompt, imageUrls }]);

    const response = await fetch("/api/agent/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: currentPrompt, model, mentions, imageUrls }),
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
            const event = JSON.parse(line.slice("data: ".length)) as ChatEvent;
            setChatLog((prev) => [...prev, event]);
            followSceneFromEvent(event);
            if (event.type === "final") setSelectedElementId(null);
          } catch {
            // ignore malformed/empty keepalive chunks
          }
        }
      }
    }

    setBusy(false);
  };

  const durationSeconds = (totalDurationInFrames(composition) / composition.fps).toFixed(1);

  const previewComposition: Composition = soloSceneId
    ? { ...composition, scenes: composition.scenes.filter((s) => s.id === soloSceneId) }
    : composition;

  const hasStoryboard = Boolean(composition.storyboard);

  return (
    <div className="app" data-mobile-tab={mobileTab}>
      <div className="header">
        <div className="header-left">
          <DevHiveLogo />
          <div className="header-divider" />
          <span className="composition-title">{composition.name}</span>
        </div>
        <div className="header-right">
          {/* Online users indicator */}
          {onlineUsers > 1 && (
            <div className="online-users-badge" title={`${onlineUsers} users online`}>
              <span className="online-dot" />
              {onlineUsers}
            </div>
          )}
          <button
            className="theme-toggle-btn"
            title={`Switch Theme (${theme})`}
            onClick={() => setTheme((t) => (t === "vanilla" ? "dark" : "vanilla"))}
          >
            {theme === "vanilla" ? "🍦 Vanilla" : "🌙 Dark"}
          </button>
          <ModelPicker value={model} onChange={setModel} />
          <button className="export-btn" onClick={() => setExportOpen(true)}>
            Export
          </button>
          <div className={`timecode ${busy ? "busy" : ""}`}>
            <span className={`rec-dot ${busy ? "active" : ""}`} />
            <span>{busy ? "agent working…" : `${durationSeconds}s @ ${composition.fps}fps`}</span>
          </div>
        </div>
      </div>

      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}

      {/* Mobile platform indicator */}
      <div className="mobile-platform-bar">
        <div className="mobile-platform-badge">{composition.orientation}</div>
        <span className="mobile-project-name">{composition.name}</span>
      </div>

      {/* Mobile tab bar */}
      <div className="mobile-tabbar">
        <button
          className={mobileTab === "timeline" ? "active" : ""}
          onClick={() => { setMobileTab("timeline"); setBottomTab("timeline"); }}
        >
          🎬 Timeline
        </button>
        <button
          className={mobileTab === "elements" ? "active" : ""}
          onClick={() => setMobileTab("elements")}
        >
          🎛️ Inspector
        </button>
        <button
          className={mobileTab === "chat" ? "active" : ""}
          onClick={() => { setMobileTab("chat"); setBottomTab("chat"); }}
        >
          🤖 Agent
        </button>
        <button
          className={mobileTab === "storyboard" ? "active" : ""}
          onClick={() => { setMobileTab("storyboard"); setBottomTab("storyboard"); }}
        >
          📋 Plan
        </button>
        <button
          className={mobileTab === "split" ? "active" : ""}
          onClick={() => { setMobileTab("split"); setBottomTab("split"); }}
        >
          ◫ Split
        </button>
      </div>

      {/* Main Video Preview Canvas */}
      <div
        className="preview"
        style={{ ["--preview-ratio" as string]: `${composition.width} / ${composition.height}` }}
      >
        <div
          className="preview-inner"
          style={{ aspectRatio: `${composition.width} / ${composition.height}` }}
        >
          <Preview composition={previewComposition} playerRef={playerRef} />
          <CanvasOverlay
            composition={composition}
            selectedSceneId={selectedSceneId}
            selectedElementId={selectedElementId}
            onPatchElement={patchElement}
          />
        </div>
      </div>

      {/* Right Sidebar: Inspector */}
      <InspectorPanel
        composition={composition}
        selectedSceneId={selectedSceneId}
        selectedElementId={selectedElementId}
        onSelectElement={setSelectedElementId}
        onPatchElement={patchElement}
        onDeleteElement={deleteElement}
        onDuplicateElement={duplicateElement}
        onUpdateSceneTransition={updateSceneTransition}
      />

      {/* Bottom Area */}
      <div className="bottom-workspace">
        <div className="bottom-workspace-tabbar">
          <button
            className={`bottom-tab-btn ${bottomTab === "timeline" ? "active" : ""}`}
            onClick={() => { setBottomTab("timeline"); setMobileTab("timeline"); }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="4" width="12" height="2" rx="1" />
              <rect x="1" y="8" width="8" height="2" rx="1" />
            </svg>
            NLE Timeline
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === "chat" ? "active" : ""}`}
            onClick={() => { setBottomTab("chat"); setMobileTab("chat"); }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5L2 13V3a1 1 0 011-1z" />
            </svg>
            AI Agent
            {chatLog.length > 0 && <span className="tab-badge">{chatLog.length}</span>}
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === "storyboard" ? "active" : ""} ${hasStoryboard ? "has-content" : ""}`}
            onClick={() => { setBottomTab("storyboard"); setMobileTab("storyboard"); }}
            title={hasStoryboard ? "View storyboard" : "No storyboard yet"}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="1" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="5" y1="5" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            Storyboard
            {hasStoryboard && <span className="storyboard-dot" />}
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === "split" ? "active" : ""}`}
            onClick={() => { setBottomTab("split"); setMobileTab("split"); }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="1" width="5" height="12" rx="1" />
              <rect x="8" y="1" width="5" height="12" rx="1" />
            </svg>
            Split
          </button>
        </div>

        <div className={`bottom-workspace-content mode-${bottomTab}`}>
          {(bottomTab === "timeline" || bottomTab === "split") && (
            <div className="bottom-pane pane-timeline">
              <NLETimelinePanel
                composition={composition}
                playerRef={playerRef}
                selectedSceneId={selectedSceneId}
                selectedElementId={selectedElementId}
                soloSceneId={soloSceneId}
                onSelectScene={(id) => setSelectedSceneId(id)}
                onSelectElement={(id) => setSelectedElementId(id)}
                onPatchElement={patchElement}
                onSplitElement={splitElement}
                onToggleSolo={(id) => setSoloSceneId((prev) => (prev === id ? null : id))}
                onAddScene={addScene}
                onDeleteScene={deleteScene}
                onUpdateSceneDuration={updateSceneDuration}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={canUndo}
                canRedo={canRedo}
              />
            </div>
          )}

          {(bottomTab === "chat" || bottomTab === "split") && (
            <div className="bottom-pane pane-chat">
              <ChatPanel
                log={chatLog}
                prompt={prompt}
                onPromptChange={setPrompt}
                busy={busy}
                onSend={sendPrompt}
                onClear={clearChat}
                composition={composition}
              />
            </div>
          )}

          {bottomTab === "storyboard" && (
            <div className="bottom-pane pane-storyboard">
              <StoryboardPanel composition={composition} onSelectScene={(id) => setSelectedSceneId(id)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
