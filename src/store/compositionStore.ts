import { promises as fs } from "fs";
import path from "path";
import { CompositionSchema, emptyComposition, type Composition } from "../schema/scene";
import { logger } from "../core/utils/logger";

const STORE_PATH = path.resolve(process.cwd(), "data", "composition.json");

type Listener = (composition: Composition) => void;

export class CompositionStore {
  private current: Composition = emptyComposition();
  private undoStack: Composition[] = [];
  private redoStack: Composition[] = [];
  private listeners = new Set<Listener>();
  private static MAX_HISTORY = 50;

  async load(): Promise<Composition> {
    try {
      const raw = await fs.readFile(STORE_PATH, "utf-8");
      this.current = CompositionSchema.parse(JSON.parse(raw));
    } catch {
      // Start empty and persist
      await this.persist();
    }
    return this.current;
  }

  get(): Composition {
    return this.current;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async set(next: Composition): Promise<Composition> {
    const parsed = CompositionSchema.parse(next);
    
    // Save current to undo stack
    this.undoStack.push(structuredClone(this.current));
    if (this.undoStack.length > CompositionStore.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    this.current = parsed;
    await this.persist();
    this.emit();
    return this.current;
  }

  async undo(): Promise<Composition | null> {
    const previous = this.undoStack.pop();
    if (!previous) return null;

    this.redoStack.push(structuredClone(this.current));
    this.current = previous;
    await this.persist();
    this.emit();
    logger.info("Composition undo applied");
    return this.current;
  }

  async redo(): Promise<Composition | null> {
    const next = this.redoStack.pop();
    if (!next) return null;

    this.undoStack.push(structuredClone(this.current));
    this.current = next;
    await this.persist();
    this.emit();
    logger.info("Composition redo applied");
    return this.current;
  }

  async update(fn: (draft: Composition) => Composition): Promise<Composition> {
    const next = fn(structuredClone(this.current));
    return this.set(next);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (err) {
        logger.error("Error in compositionStore listener", err);
      }
    }
  }

  private async persist() {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(this.current, null, 2));
  }
}

export const compositionStore = new CompositionStore();
// Export alias for backward compatibility during transition
export const sceneStore = compositionStore;
