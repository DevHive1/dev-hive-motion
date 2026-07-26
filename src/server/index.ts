import "dotenv/config";
import path from "path";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import type { Message } from "ollama";
import { compositionStore } from "../store/compositionStore";
import { chatLogStore } from "./chatLogStore";
import { runAgent } from "../agent/agentLoop";
import { logger } from "../core/utils/logger";
import { ollama, DEFAULT_OLLAMA_MODEL } from "../agent/ollamaClient";
import { CompositionSchema } from "../schema/scene";
import { renderComposition, RENDERS_DIR, type RenderFormat } from "./render";
import { renderSingleScene } from "./renderSingleScene";
import { saveDataUrl } from "./assetUpload";

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/renders", express.static(RENDERS_DIR));

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
app.use(express.static(PUBLIC_DIR));
// Serve uploaded assets at /uploads/* so the live preview and the
// Remotion renderer can both fetch them. We serve from public/uploads/
// (the directory assetUpload.ts writes to). Without this, the file
// would be on disk but unreachable from the browser or the renderer.
app.use(
  "/uploads",
  express.static(path.join(PUBLIC_DIR, "uploads"), {
    setHeaders: (res) => {
      // Reasonable cache - assets don't change once uploaded.
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  }),
);

const PORT = Number(process.env.PORT ?? 4000);
let conversationHistory: Message[] = [];

// ─── WebSocket: Real-time Collaboration ──────────────────────────────────────

function getOnlineCount() {
  return [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length;
}

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on("connection", (ws) => {
  // Send current state immediately to the new client
  ws.send(
    JSON.stringify({
      type: "composition",
      composition: compositionStore.get(),
      canUndo: compositionStore.canUndo(),
      canRedo: compositionStore.canRedo(),
    }),
  );
  // Broadcast updated user count to all
  broadcast({ type: "users", count: getOnlineCount() });

  ws.on("close", () => {
    broadcast({ type: "users", count: getOnlineCount() });
  });
  ws.on("error", () => {});
});

// Push every composition change to all WebSocket clients
compositionStore.onChange((composition) => {
  broadcast({
    type: "composition",
    composition,
    canUndo: compositionStore.canUndo(),
    canRedo: compositionStore.canRedo(),
  });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
await compositionStore.load();
await chatLogStore.load();

// ─── Composition API ─────────────────────────────────────────────────────────
app.get("/api/composition", (_req, res) => {
  res.json(compositionStore.get());
});

app.put("/api/composition", async (req, res) => {
  try {
    const parsed = CompositionSchema.parse(req.body);
    const saved = await compositionStore.set(parsed);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/composition/undo", async (_req, res) => {
  const result = await compositionStore.undo();
  if (!result) {
    res.status(400).json({ error: "Nothing to undo" });
    return;
  }
  res.json({
    composition: result,
    canUndo: compositionStore.canUndo(),
    canRedo: compositionStore.canRedo(),
  });
});

app.post("/api/composition/redo", async (_req, res) => {
  const result = await compositionStore.redo();
  if (!result) {
    res.status(400).json({ error: "Nothing to redo" });
    return;
  }
  res.json({
    composition: result,
    canUndo: compositionStore.canUndo(),
    canRedo: compositionStore.canRedo(),
  });
});

app.get("/api/composition/history-state", (_req, res) => {
  res.json({ canUndo: compositionStore.canUndo(), canRedo: compositionStore.canRedo() });
});

// SSE stream kept for backward compatibility
app.get("/api/composition/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const sendState = () => {
    res.write(
      `data: ${JSON.stringify({
        composition: compositionStore.get(),
        canUndo: compositionStore.canUndo(),
        canRedo: compositionStore.canRedo(),
      })}\n\n`,
    );
  };
  sendState();
  const unsubscribe = compositionStore.onChange(() => sendState());
  req.on("close", unsubscribe);
});


// ─── Models ──────────────────────────────────────────────────────────────────
app.get("/api/models", async (_req, res) => {
  try {
    const { models } = await ollama.list();
    res.json({ models: models.map((m) => m.name), defaultModel: DEFAULT_OLLAMA_MODEL });
  } catch (err) {
    res.status(502).json({
      error: `Couldn't reach Ollama: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// ─── Chat Log ────────────────────────────────────────────────────────────────
app.get("/api/chatlog", (_req, res) => {
  res.json(chatLogStore.get());
});

app.delete("/api/chatlog", async (_req, res) => {
  await chatLogStore.clear();
  const prevLen = conversationHistory.length;
  conversationHistory = [];
  logger.info("Chat cleared", { conversationHistoryWasLength: prevLen });
  res.json({ ok: true });
});

// ─── Asset Upload ────────────────────────────────────────────────────────────
// Persist an attached image to public/uploads/ and return the saved URL.
// The client can use this for any image it wants to embed persistently
// (user-attached reference images, agent-generated images before
// they're added to a scene). The saved URL is what gets used in
// element.src - it's stable across restarts and renders reliably in
// the exported video. Without this, a base64 data URL embedded in the
// composition JSON renders in the live preview but fails (or bloats
// the JSON to MBs) when the video is exported.
app.post("/api/upload", async (req, res) => {
  const { dataUrl, name } = req.body as { dataUrl?: string; name?: string };
  if (!dataUrl) {
    res.status(400).json({ error: "Missing 'dataUrl' in request body." });
    return;
  }
  try {
    const savedUrl = await saveDataUrl(dataUrl);
    res.json({ url: savedUrl, name: name ?? "" });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Agent ───────────────────────────────────────────────────────────────────
app.post("/api/agent/prompt", async (req, res) => {
  const { prompt, model, mentions, imageUrls } = req.body as {
    prompt?: string;
    model?: string;
    mentions?: Array<{ type: string; id: string; name: string }>;
    imageUrls?: string[];
  };

  if (!prompt) {
    res.status(400).json({ error: "Missing 'prompt' in request body." });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  // Persist any attached data URLs to disk before the agent sees them.
  // The agent receives BOTH the data URL (for the model's vision) AND
  // the saved URL (for element.src). The PromptEngine reminder tells
  // the agent: "use the saved URL, not the data URL, when adding it to
  // a scene". If the data URL is already a saved URL (e.g. re-sent
  // across a refresh), saveDataUrl returns it unchanged.
  const savedImageUrls: string[] = [];
  if (imageUrls && imageUrls.length > 0) {
    for (const url of imageUrls) {
      try {
        const saved = await saveDataUrl(url);
        savedImageUrls.push(saved);
      } catch (err) {
        // If saving fails, fall back to the original URL. The agent
        // will still get the image, just not as a persisted file.
        console.warn(`[upload] failed to save image:`, err instanceof Error ? err.message : err);
        savedImageUrls.push(url);
      }
    }
  }

  await chatLogStore.append({ type: "user_prompt", text: prompt, mentions, imageUrls });

  const updatedHistory = await runAgent(
    prompt,
    conversationHistory,
    (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      chatLogStore.append(event).catch(() => {});
    },
    model || DEFAULT_OLLAMA_MODEL,
    { mentions, imageUrls, savedImageUrls },
  );

  conversationHistory = updatedHistory.slice(-40);
  res.write("event: done\ndata: {}\n\n");
  res.end();
});

// ─── Render ──────────────────────────────────────────────────────────────────
app.post("/api/render", async (req, res) => {
  const { format } = req.body as { format?: RenderFormat };
  const chosenFormat: RenderFormat = format === "gif" ? "gif" : "mp4";

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  await renderComposition(compositionStore.get(), chosenFormat, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  res.write("event: done\ndata: {}\n\n");
  res.end();
});

// Single-scene preview render (preview_single_scene tool). Streams progress
// over SSE so the agent / UI can show a spinner, then returns the file URL.
app.post("/api/render/scene", async (req, res) => {
  const { sceneId, format } = req.body as { sceneId?: string; format?: "mp4" | "gif" };
  if (!sceneId) {
    res.status(400).json({ error: "Missing 'sceneId' in request body." });
    return;
  }

  // Verify the scene exists in the current composition before kicking
  // off a 30s+ render.
  const composition = compositionStore.get();
  const scene = composition.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    res.status(404).json({ error: `No scene with id "${sceneId}".` });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  try {
    const result = await renderSingleScene(sceneId, format ?? "mp4", (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: "url", url: result.url, durationSeconds: result.durationSeconds })}\n\n`);
    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`,
    );
    res.end();
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`DevHive Motion — API + WebSocket on http://localhost:${PORT}`);
});
