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
import { useKeyboard } from "./hooks/useKeyboard";
import type { MentionItem } from "./components/chat/MentionInput";

type MobileTab = "timeline" | "elements" | "chat" | "split";
type BottomTab = "timeline" | "chat" | "split";

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
  const patchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Subscribe to live composition updates - the agent (or another browser
  // tab) can change the project and this view reflects it immediately.
  useEffect(() => {
    const source = new EventSource("/api/composition/stream");
    source.onmessage = (event) => {
      const next: Composition = JSON.parse(event.data);
      setComposition(next);
      setSelectedSceneId((prev) => {
        if (prev && next.scenes.some((s) => s.id === prev)) return prev;
        return next.scenes[next.scenes.length - 1]?.id ?? null;
      });
    };
    return () => source.close();
  }, []);

  // Fetch chat log on mount
  useEffect(() => {
    fetch("/api/chatlog")
      .then((res) => res.json())
      .then((entries: ChatEvent[]) => setChatLog(entries))
      .catch(() => {});
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
        const next: Composition = await res.json();
        setComposition(next);
      }
    } catch {
      // ignore
    }
  };

  const handleRedo = async () => {
    try {
      const res = await fetch("/api/composition/redo", { method: "POST" });
      if (res.ok) {
        const next: Composition = await res.json();
        setComposition(next);
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
    if (splitFrame <= element.startFrame + 2 || splitFrame >= elementEnd - 2) {
      return;
    }

    const firstPartDuration = splitFrame - element.startFrame;
    const secondPartStart = splitFrame;
    const secondPartDuration = elementEnd - splitFrame;

    const secondPart = {
      ...structuredClone(element),
      id: `el-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      name: `${element.name} (Part 2)`,
      startFrame: secondPartStart,
      durationInFrames: secondPartDuration,
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

    const next: Composition = {
      ...composition,
      scenes: [...composition.scenes, newScene],
    };
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

  // Bind keyboard shortcuts
  useKeyboard({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDelete: () => {
      if (selectedElementId) deleteElement(selectedElementId);
    },
    onDuplicate: () => {
      if (selectedElementId) duplicateElement(selectedElementId);
    },
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
      body: JSON.stringify({
        prompt: currentPrompt,
        model,
        mentions,
        imageUrls,
      }),
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
            const event = JSON.parse(line.slice("data: ".length)) as ChatEvent;
            setChatLog((prev) => [...prev, event]);
            followSceneFromEvent(event);
            if (event.type === "final") {
              setSelectedElementId(null);
            }
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

  return (
    <div className="app" data-mobile-tab={mobileTab}>
      <div className="header">
        <div className="header-left">
          <DevHiveLogo />
        </div>
        <div className="header-right">
          <button
            className="theme-toggle-btn"
            title={`Switch Theme (Current: ${theme})`}
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

      <div className="mobile-tabbar">
        <button
          className={mobileTab === "timeline" ? "active" : ""}
          onClick={() => {
            setMobileTab("timeline");
            setBottomTab("timeline");
          }}
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
          onClick={() => {
            setMobileTab("chat");
            setBottomTab("chat");
          }}
        >
          🤖 Agent
        </button>
        <button
          className={mobileTab === "split" ? "active" : ""}
          onClick={() => {
            setMobileTab("split");
            setBottomTab("split");
          }}
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

      {/* Bottom Area: NLE Timeline & AI Agent Chat Workspace */}
      <div className="bottom-workspace">
        <div className="bottom-workspace-tabbar">
          <button
            className={`bottom-tab-btn ${bottomTab === "timeline" ? "active" : ""}`}
            onClick={() => {
              setBottomTab("timeline");
              setMobileTab("timeline");
            }}
          >
            🎬 NLE Timeline
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === "chat" ? "active" : ""}`}
            onClick={() => {
              setBottomTab("chat");
              setMobileTab("chat");
            }}
          >
            🤖 AI Agent Workspace
            {chatLog.length > 0 && <span className="tab-badge">{chatLog.length}</span>}
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === "split" ? "active" : ""}`}
            onClick={() => {
              setBottomTab("split");
              setMobileTab("split");
            }}
          >
            ◫ Split View
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
                canUndo={true}
                canRedo={true}
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
        </div>
      </div>
    </div>
  );
};
