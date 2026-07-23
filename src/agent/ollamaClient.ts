import { Ollama } from "ollama";

// This is only a fallback for scripts/tools that call the agent without
// going through the editor UI. The editor always sends an explicit model
// (picked from the dropdown, populated from GET /api/models) with every
// request - see src/server/index.ts and src/editor/App.tsx.
export const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

export const ollama = new Ollama({ host: OLLAMA_HOST });
