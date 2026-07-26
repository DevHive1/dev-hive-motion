/**
 * Template store: named scene templates the agent can save and re-apply.
 *
 * A template is the full set of fields needed to build a scene:
 *   - durationInFrames, backgroundColor, transitionIn
 *   - element list (each with x/y/width/height, text/src, animations)
 *
 * Templates are persisted to disk (templates.json in the user data dir)
 * so they survive restarts. The agent can:
 *   - apply_template({ templateName, sceneId? }) to build a new scene
 *     from a template, or to overwrite an existing scene's contents
 *   - save_scene_as_template({ sceneId, templateName, overwrite? }) to
 *     capture a successful scene as a reusable pattern
 *   - list_templates() to see what's available
 *   - delete_template({ templateName }) to remove one
 *
 * Why this exists: the agent builds similar scene structures over and
 * over (hero reveal, stat callout, quote slide, CTA card). Without
 * templates, every "hero reveal" is reconstructed from scratch and
 * drifts from one to the next. With templates, the agent saves its
 * best hero reveal once and reuses it 3 times identically.
 *
 * Templates are stored separately from the composition so they don't
 * pollute the project state. They live in their own JSON file and
 * can be browsed, deleted, and renamed independently.
 */

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

// Shape of a single element inside a template. Mirrors the relevant
// fields from SceneElementSchema but is permissive (any element type
// is allowed, extra fields are preserved).
const TemplateElementSchema = z.object({
  type: z.enum(["text", "image", "video", "shape", "custom", "audio"]),
  // Common position/animation fields - the agent is expected to fill
  // these based on the current scene's design language.
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  zIndex: z.number().optional(),
  startFrame: z.number().optional(),
  durationInFrames: z.number().optional(),
  // The rest is passed through as-is (text, src, fill, animations, etc.)
}).passthrough();

const TemplateSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Genre tag (optional) so the agent can pick the right template
  // automatically when a project genre is set on the storyboard.
  genre: z.string().optional(),
  // The scene payload itself.
  durationInFrames: z.number().min(1).default(150),
  backgroundColor: z.string().default("#0b0b0f"),
  transitionIn: z
    .object({
      type: z.string(),
      direction: z.string().optional(),
      durationInFrames: z.number().optional(),
    })
    .optional(),
  elements: z.array(TemplateElementSchema).default([]),
});

export type TemplateElement = z.infer<typeof TemplateElementSchema>;
export type Template = z.infer<typeof TemplateSchema>;

// Templates are saved next to other user data. We resolve the path
// lazily on first use so the module is safe to import in environments
// without a writable data dir (tests, serverless).
let _cache: Map<string, Template> | null = null;
let _writeQueue: Promise<void> = Promise.resolve();

function templatesPath(): string {
  // data/ at repo root, mirroring the existing user-data convention.
  return path.join(process.cwd(), "data", "templates.json");
}

async function loadFromDisk(): Promise<Map<string, Template>> {
  const file = templatesPath();
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    const map = new Map<string, Template>();
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const result = TemplateSchema.safeParse(item);
        if (result.success) {
          map.set(result.data.name, result.data);
        }
      }
    }
    return map;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      return new Map();
    }
    // Any other error: log and start with an empty map so the agent
    // can still save new templates.
    console.error("[templates] failed to load:", err);
    return new Map();
  }
}

async function ensureLoaded(): Promise<Map<string, Template>> {
  if (_cache) return _cache;
  _cache = await loadFromDisk();
  return _cache;
}

async function persist(): Promise<void> {
  if (!_cache) return;
  // Serialize writes to avoid clobbering concurrent saves.
  _writeQueue = _writeQueue.then(async () => {
    const file = templatesPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const arr = Array.from(_cache!.values());
    await fs.writeFile(file, JSON.stringify(arr, null, 2), "utf-8");
  });
  await _writeQueue;
}

export async function listTemplates(): Promise<Template[]> {
  const cache = await ensureLoaded();
  return Array.from(cache.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(name: string): Promise<Template | undefined> {
  const cache = await ensureLoaded();
  return cache.get(name);
}

export async function saveTemplate(template: Template): Promise<void> {
  const cache = await ensureLoaded();
  cache.set(template.name, template);
  await persist();
}

export async function deleteTemplate(name: string): Promise<boolean> {
  const cache = await ensureLoaded();
  const had = cache.delete(name);
  if (had) await persist();
  return had;
}

/**
 * Build a fresh Template from a scene by stripping the id/instance-
 * specific fields and keeping the rest. The agent can call this when
 * it wants to capture a successful scene as a reusable pattern.
 */
export function templateFromScene(scene: {
  name: string;
  durationInFrames: number;
  backgroundColor: string;
  transitionIn?: { type: string; direction?: string; durationInFrames?: number } | null;
  elements: Array<Record<string, unknown>>;
}, opts: { templateName: string; description?: string; genre?: string }): Template {
  return {
    name: opts.templateName,
    description: opts.description ?? "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    genre: opts.genre,
    durationInFrames: scene.durationInFrames,
    backgroundColor: scene.backgroundColor,
    transitionIn: scene.transitionIn ?? undefined,
    elements: scene.elements as unknown as TemplateElement[],
  };
}

/**
 * Reset the cache. Tests use this to start clean; the agent does not.
 */
export function _resetTemplateCache(): void {
  _cache = null;
  _writeQueue = Promise.resolve();
}
