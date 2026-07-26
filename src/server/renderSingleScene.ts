import path from "path";
import { promises as fs } from "fs";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ChromiumOptions } from "@remotion/renderer";
import { emptyComposition, type Composition } from "../schema/scene";

const ENTRY_POINT = path.resolve(process.cwd(), "src/remotion/index.ts");
const RENDERS_DIR = path.resolve(process.cwd(), "data", "renders");
const CHROMIUM_WRAPPER = path.resolve(process.cwd(), "scripts", "chromium-wrapper.sh");

// Mirror the env-driven Chromium setup from src/server/render.ts so the
// single-scene preview works in the same environments (including Termux
// with CHROME_EXECUTABLE_PATH pointing at a Termux Chromium build).
const browserExecutable = process.env.CHROME_EXECUTABLE_PATH ? CHROMIUM_WRAPPER : undefined;
const chromiumOptions: ChromiumOptions = {
  gl: process.env.CHROME_EXECUTABLE_PATH ? "swiftshader" : undefined,
  enableMultiProcessOnLinux: process.env.CHROME_EXECUTABLE_PATH ? false : undefined,
  headless: process.env.CHROME_HEADLESS === "false" ? false : true,
};
const timeoutInMilliseconds = Number(process.env.RENDER_TIMEOUT_MS ?? 120_000);

// Reuse the same bundle cache as src/server/render.ts by importing the
// cached serveUrl. The cache key is the bundling result, which is the
// same for both the full composition and a one-scene preview - the
// difference is only in the inputProps passed at render time.
let cachedServeUrl: string | null = null;
let bundling: Promise<string> | null = null;

async function getServeUrl(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl;
  if (!bundling) {
    // Lazy-import to avoid a circular import with the main render module.
    const { bundle } = await import("@remotion/bundler");
    bundling = bundle({ entryPoint: ENTRY_POINT, onProgress: () => {} });
  }
  cachedServeUrl = await bundling;
  return cachedServeUrl;
}

export interface SingleSceneRenderResult {
  url: string;
  fileName: string;
  durationSeconds: number;
  format: "mp4" | "gif";
}

/**
 * Render a single scene to an MP4/GIF. The composition is rebuilt as a
 * one-scene composition so Remotion's MainComposition can render it
 * with the same entry point - no separate preview component needed.
 *
 * The onEvent callback receives a progress event similar to the main
 * render pipeline. The tool caller in src/agent/tools/scene/preview.ts
 * currently just awaits the final result; the progress hook is here
 * for the SSE /api/render/scene endpoint to forward to the client.
 */
export async function renderSingleScene(
  sceneId: string,
  format: "mp4" | "gif" = "mp4",
  onEvent?: (event: { type: "bundling" | "rendering" | "done" | "error"; progress?: number; fileName?: string; message?: string; url?: string }) => void,
  sceneSnapshot?: Composition,
): Promise<SingleSceneRenderResult> {
  try {
    onEvent?.({ type: "bundling", progress: 0 });

    // Lazy-import to read the latest composition only when called from
    // the agent path. The HTTP path passes sceneSnapshot in directly so
    // it can render an arbitrary composition without mutating the store.
    const { sceneStore } = await import("../store/compositionStore");
    const composition = sceneSnapshot ?? sceneStore.get();
    const scene = composition.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      throw new Error(`No scene with id "${sceneId}".`);
    }

    const singleComposition: Composition = {
      ...emptyComposition(),
      id: `preview-${scene.id}`,
      name: `Preview: ${scene.name}`,
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      orientation: composition.orientation,
      scenes: [scene],
      globalAudio: [],
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        durationSeconds: scene.durationInFrames / composition.fps,
      },
    };

    const serveUrl = await getServeUrl();
    const inputProps = { composition: singleComposition };

    const videoConfig = await selectComposition({
      serveUrl,
      id: "MainComposition",
      inputProps,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds,
    });

    await fs.mkdir(RENDERS_DIR, { recursive: true });
    const fileName = `preview-${sceneId}-${Date.now()}.${format === "gif" ? "gif" : "mp4"}`;
    const outputLocation = path.join(RENDERS_DIR, fileName);

    await renderMedia({
      composition: videoConfig,
      serveUrl,
      codec: format === "gif" ? "gif" : "h264",
      outputLocation,
      inputProps,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds,
      scale: format === "gif" ? 0.5 : 1,
      onProgress: ({ progress }) => {
        onEvent?.({ type: "rendering", progress });
      },
    });

    const url = `/renders/${fileName}`;
    onEvent?.({ type: "done", fileName, url });
    return {
      url,
      fileName,
      durationSeconds: scene.durationInFrames / composition.fps,
      format,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent?.({ type: "error", message });
    throw err;
  }
}
