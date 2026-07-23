import { promises as fs } from "fs";
import path from "path";

const STORE_PATH = path.resolve(process.cwd(), "data", "chatlog.json");
const MAX_ENTRIES = 500;

export type ChatLogEntry =
  | { type: "user_prompt"; text: string; mentions?: any[]; imageUrls?: string[] }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "tool_error"; name: string; error: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export class ChatStore {
  private entries: ChatLogEntry[] = [];
  private loaded = false;

  async load(): Promise<ChatLogEntry[]> {
    if (this.loaded) return this.entries;
    try {
      const raw = await fs.readFile(STORE_PATH, "utf-8");
      this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
    this.loaded = true;
    return this.entries;
  }

  get(): ChatLogEntry[] {
    return this.entries;
  }

  async append(entry: ChatLogEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  private async persist() {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(this.entries, null, 2));
  }
}

export const chatStore = new ChatStore();
export const chatLogStore = chatStore;
