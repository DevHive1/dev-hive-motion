/**
 * Shared validation for element patches used by update_element, build_scene,
 * and duplicate_element.
 *
 * The agent's reported bug: `update_element` silently accepted any patch
 * (e.g. `durationInFrames: 0`, `startFrame: -5`, `x: 200`), merged it into
 * the element with no schema check, and then the resulting invalid element
 * either broke rendering or was caught much later by a confused tool error.
 *
 * This helper re-validates the merged element after the patch is applied,
 * and translates zod errors into a short, actionable message the agent
 * can actually use to fix the call (e.g. "durationInFrames must be >= 1, you
 * passed 0").
 */

import { ZodError } from "zod";
import { SceneElementSchema } from "../../../schema/scene";

export function validateElementPatch(
  sceneId: string,
  elementId: string,
  merged: unknown,
): void {
  const result = SceneElementSchema.safeParse(merged);
  if (result.success) return;

  const zodError = result.error as ZodError;
  const issues = zodError.issues ?? [];
  const summary = issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
  const more = issues.length > 3 ? `\n  - ...and ${issues.length - 3} more` : "";

  throw new Error(
    `update_element patch for element "${elementId}" in scene "${sceneId}" produced an invalid element:\n${summary}${more}\n` +
      `Common causes: durationInFrames must be >= 1, startFrame must be >= 0, x/y/width/height are percent (0-100), ` +
      `opacity is 0-1, fontSize must be > 0. Fix the patch and call update_element again.`,
  );
}

/**
 * Detect the "transparent background + short/empty scene = black screen"
 * failure the agent hit (item 3 in error.txt). Returns a warning string
 * suitable for review_scene / build_scene output, or null if no problem.
 */
export function checkTransparentBlackScreen(scene: {
  backgroundColor?: string;
  durationInFrames: number;
  elements: Array<{
    type: string;
    transparentBackground?: boolean;
    startFrame: number;
    durationInFrames: number;
  }>;
}): string | null {
  if (scene.elements.length === 0) return null;

  const visibleAtFrame0 = scene.elements.some(
    (el) => el.startFrame === 0 && el.type !== "audio",
  );
  if (visibleAtFrame0) return null;

  // Has background color set → fine, the background is what we see.
  if (scene.backgroundColor && scene.backgroundColor !== "transparent") return null;

  const onlyTransparent = scene.elements.every(
    (el) => el.type === "audio" || (el.type === "custom" && el.transparentBackground),
  );
  if (!onlyTransparent) return null;

  // Every "content" element either starts later or is transparent.
  // The frame-0 render will be black/blank.
  const firstVisibleStart = Math.min(
    ...scene.elements.filter((el) => el.type !== "audio").map((el) => el.startFrame),
  );

  if (firstVisibleStart > 0) {
    return (
      `Scene has no visible content at frame 0 - the first element starts at frame ${firstVisibleStart}, ` +
      `so frame 0 will render as a blank/black screen. ` +
      `Either set a backgroundColor on the scene, set startFrame:0 on at least one element, ` +
      `or set transparentBackground:false on the custom element (and give it a fill/background).`
    );
  }

  return null;
}
