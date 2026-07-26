import { sceneStore } from "../../../server/sceneStore";
import { emptyComposition, type Composition } from "../../../schema/scene";

/**
 * preview_single_scene — error.txt item 7.
 *
 * Render a single scene to MP4 so the agent can verify the timing of
 * animations and the layout looks right BEFORE adding it to the full
 * video. The existing editor has a "solo" toggle but it loops in the
 * browser preview and doesn't produce a downloadable file - this tool
 * gives back a URL to a real MP4 of just that one scene.
 *
 * Implementation: posts to the server's existing /api/render/scene
 * endpoint (added in server/index.ts), which builds a one-scene
 * composition and reuses the existing render pipeline. The tool just
 * forwards the call and returns the URL the server reports back.
 */
export const previewSingleSceneDef = {
  type: "function",
    function: {
      name: "preview_single_scene",
      description:
        "Render a single scene to MP4 so you can verify the timing and layout look right BEFORE adding it to the full video. The editor's 'solo' toggle only loops in the live browser preview and doesn't produce a downloadable file; this returns a real URL to a downloadable MP4 of just that one scene. Use it after building a scene with nontrivial animations - much faster feedback than rendering the whole project. Returns the URL when the render finishes (or a progress event for very long renders).",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string", description: "The scene to render in isolation." },
          format: { type: "string", enum: ["mp4", "gif"], description: "Output format. Defaults to mp4." },
        },
        required: ["sceneId"],
      },
    },
  };

type PreviewArgs = {
  sceneId: string;
  format?: "mp4" | "gif";
};

/**
 * Build a single-scene composition that mirrors the original scene's
 * settings - the server endpoint uses this as the inputProps for the
 * render pipeline so it doesn't need to know about scene selection.
 */
export function buildSingleSceneComposition(sceneId: string): Composition {
  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new Error(`No scene with id "${sceneId}". Call list_scenes to see valid ids.`);
  }

  const single: Composition = {
    ...emptyComposition(),
    id: `preview-${scene.id}`,
    name: `Preview: ${scene.name}`,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    orientation: composition.orientation,
    scenes: [scene],
    globalAudio: [], // No global audio in a single-scene preview
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationSeconds: scene.durationInFrames / composition.fps,
    },
  };
  return single;
}

export async function previewSingleSceneImpl(args: PreviewArgs) {
  // Validate the scene exists up front, so the tool call fails fast with
  // a useful error instead of an HTTP 400 from the server.
  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === args.sceneId);
  if (!scene) {
    throw new Error(`No scene with id "${args.sceneId}". Call list_scenes to see valid ids.`);
  }

  // Hit the local server's /api/render/scene endpoint. The server
  // handles the actual bundling + renderMedia call and returns the file
  // URL when done.
  // We import the server-side helper lazily so this module can be loaded
  // in environments where the server hasn't started (e.g. unit tests of
  // tool registration).
  const { renderSingleScene } = await import("../../../server/renderSingleScene");
  const result = await renderSingleScene(args.sceneId, args.format ?? "mp4");
  return result;
}
