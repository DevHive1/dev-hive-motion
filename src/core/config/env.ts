import { z } from "zod";

const EnvSchema = z.object({
  OLLAMA_HOST: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5-coder:7b"),
  PORT: z.coerce.number().default(4000),
  PEXELS_API_KEY: z.string().optional(),
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  CHROME_HEADLESS: z.enum(["true", "false"]).default("true"),
  RENDER_TIMEOUT_MS: z.coerce.number().default(120_000),
  MAX_AGENT_ITERATIONS: z.coerce.number().default(80),
  MAX_CONVERSATION_HISTORY: z.coerce.number().default(40),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
