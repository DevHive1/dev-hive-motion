import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import type { Message } from "ollama";
import { compositionStore } from "../store/compositionStore";
import { chatLogStore } from "./chatLogStore";
import { runAgent } from "../agent/agentLoop";
import { ollama, DEFAULT_OLLAMA_MODEL } from "../agent/ollamaClient";
import { CompositionSchema } from "../schema/scene";
import { renderComposition, RENDERS_DIR, type RenderFormat } from "./render";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/renders", express.static(RENDERS_DIR));

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
app.use(express.static(PUBLIC_DIR));

const PORT = Number(process.env.PORT ?? 4000);

let conversationHistory: Message[] = [];

await compositionStore.load();
await chatLogStore.load();

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
  res.json(result);
});

app.post("/api/composition/redo", async (_req, res) => {
  const result = await compositionStore.redo();
  if (!result) {
    res.status(400).json({ error: "Nothing to redo" });
    return;
  }
  res.json(result);
});

app.get("/api/composition/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(compositionStore.get())}\n\n`);

  const unsubscribe = compositionStore.onChange((composition) => {
    res.write(`data: ${JSON.stringify(composition)}\n\n`);
  });

  req.on("close", unsubscribe);
});

app.get("/api/models", async (_req, res) => {
  try {
    const { models } = await ollama.list();
    res.json({
      models: models.map((m) => m.name),
      defaultModel: DEFAULT_OLLAMA_MODEL,
    });
  } catch (err) {
    res.status(502).json({
      error: `Couldn't reach Ollama at configured host: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.get("/api/chatlog", (_req, res) => {
  res.json(chatLogStore.get());
});

app.delete("/api/chatlog", async (_req, res) => {
  await chatLogStore.clear();
  conversationHistory = [];
  res.json({ ok: true });
});

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

  await chatLogStore.append({ type: "user_prompt", text: prompt, mentions, imageUrls });

  const updatedHistory = await runAgent(
    prompt,
    conversationHistory,
    (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      chatLogStore.append(event).catch(() => {});
    },
    model || DEFAULT_OLLAMA_MODEL,
    { mentions, imageUrls },
  );

  conversationHistory = updatedHistory.slice(-40);

  res.write("event: done\ndata: {}\n\n");
  res.end();
});

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

app.listen(PORT, () => {
  console.log(`Enterprise Agent Studio API listening on http://localhost:${PORT}`);
});
