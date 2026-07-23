import path from "path";
import { promises as fs } from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ChromiumOptions } from "@remotion/renderer";
import type { Composition } from "../schema/scene";

const ENTRY_POINT = path.resolve(process.cwd(), "src/remotion/index.ts");
const RENDERS_DIR = path.resolve(process.cwd(), "data", "renders");
const CHROMIUM_WRAPPER = path.resolve(process.cwd(), "scripts", "chromium-wrapper.sh");

/**
 * If CHROME_EXECUTABLE_PATH is set (see .env.example - this is for
 * environments like Termux/Android where Remotion's own bundled Chrome
 * Headless Shell has no build), route through the wrapper script that
 * injects the extra flags Remotion's typed chromiumOptions doesn't expose.
 * Otherwise, undefined lets Remotion use/download its own Chrome as usual.
 */
const browserExecutable = process.env.CHROME_EXECUTABLE_PATH ? CHROMIUM_WRAPPER : undefined;

const chromiumOptions: ChromiumOptions = {
  // Software rendering - avoids depending on GPU driver support that's
  // frequently missing/unreliable for Chromium on Android.
  gl: process.env.CHROME_EXECUTABLE_PATH ? "swiftshader" : undefined,
  // Matches --single-process in environments where Chromium's normal
  // multi-process model doesn't work (Android's process/namespace
  // restrictions) - only relevant when using a custom browserExecutable.
  enableMultiProcessOnLinux: process.env.CHROME_EXECUTABLE_PATH ? false : undefined,
  headless: process.env.CHROME_HEADLESS === "false" ? false : true,
};

// Remotion's default timeout for delayRender() calls (page load, fetching
// remote video sources to extract frames, etc) is far too short for a slow
// mobile connection - a Pexels video fetch alone can blow past 30s. This is
// generous on purpose; render still finishes as soon as it's actually done,
// this only raises how long it's allowed to keep trying.
const timeoutInMilliseconds = Number(process.env.RENDER_TIMEOUT_MS ?? 120_000);

let cachedServeUrl: string | null = null;
let bundling: Promise<string> | null = null;

/**
 * Bundling the Remotion project is slow (webpack) but only needs to happen
 * once per server process - the composition DATA changes between renders,
 * not the code, so the bundle itself can be reused via inputProps.
 */
async function getServeUrl(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl;
  if (!bundling) {
    bundling = bundle({ entryPoint: ENTRY_POINT, onProgress: () => {} });
  }
  cachedServeUrl = await bundling;
  return cachedServeUrl;
}

export type RenderFormat = "mp4" | "gif";

export interface RenderProgressEvent {
  type: "bundling" | "rendering" | "done" | "error";
  progress?: number; // 0-1
  fileName?: string;
  message?: string;
}

export async function renderComposition(
  composition: Composition,
  format: RenderFormat,
  onEvent: (event: RenderProgressEvent) => void,
): Promise<void> {
  try {
    onEvent({ type: "bundling", progress: 0 });
    const serveUrl = await getServeUrl();

    const inputProps = { composition };

    const videoConfig = await selectComposition({
      serveUrl,
      id: "MainComposition",
      inputProps,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds,
    });

    await fs.mkdir(RENDERS_DIR, { recursive: true });
    const fileName = `render-${Date.now()}.${format === "gif" ? "gif" : "mp4"}`;
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
      // GIFs get huge fast at full HD - scale down for a reasonable file size.
      scale: format === "gif" ? 0.5 : 1,
      onProgress: ({ progress }) => {
        onEvent({ type: "rendering", progress });
      },
    });

    onEvent({ type: "done", fileName });
  } catch (err) {
    onEvent({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export { RENDERS_DIR };
