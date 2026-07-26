/**
 * edit_timing - bulk timing operations on a single scene's elements,
 * without touching the rest of the scene. The agent used to have to
 * retime every animation one by one via set_animation_timing, which
 * gets tedious when you want to "shift the whole scene's motion back
 * 15 frames" or "stagger every element by 8 frames".
 *
 * Three operations, mutually exclusive (pass exactly one):
 *
 *   1. shiftAllBy: shift every animation's startFrame and every
 *      element's startFrame by N frames. Negative = earlier. Use this
 *      for "the whole reveal is too late, pull it 15 frames earlier".
 *
 *   2. staggerBy: re-distribute element entrance timings so each
 *      element enters N frames after the previous one. Use this for
 *      "the elements all pop in at the same time, stagger them 8
 *      frames apart" - the standard rhythmic reveal.
 *
 *   3. retime (single field): retime a specific element by id or
 *      name. Same as set_animation_timing but at the element level
 *      (changes the element's startFrame, durationInFrames, and
 *      optionally scales its animations proportionally).
 *
 * Why this exists: the grammar of motion in the system prompt talks
 * about "fast 12f / standard 18f / dramatic 28f" patterns. The agent
 * needs an efficient way to APPLY those patterns across a scene's
 * elements without 8 individual set_animation_timing calls.
 */

import { sceneStore } from "../../../server/sceneStore";

interface EditTimingArgs {
  sceneId: string;
  /** Shift every animation's startFrame and every element's startFrame by this many frames. */
  shiftAllBy?: number;
  /** Re-stagger element entrances so each enters N frames after the previous. */
  staggerBy?: number;
  /** Base startFrame for the first element in the stagger sequence. Default 0. */
  staggerBaseStartFrame?: number;
  /** Stagger the element startFrame AND each animation's startFrame, vs just element-level. */
  staggerIncludesAnimations?: boolean;
  /** Scale durations by this factor (e.g. 0.5 = half as long). Affects element + animations. */
  scaleDurationsBy?: number;
  /** Target a specific element by id. */
  elementId?: string;
  /** Or target by name (when there are multiple elements with the same name, takes the first). */
  elementName?: string;
  /** For single-element retiming: new startFrame. */
  startFrame?: number;
  /** For single-element retiming: new durationInFrames. */
  durationInFrames?: number;
  /** For single-element retiming: scale this element's animation durations by N. */
  animationScale?: number;
}

export const editTimingDef = {
  type: "function",
    function: {
      name: "edit_timing",
      description:
        "Bulk timing edits on a single scene's elements, without rebuilding the scene. " +
        "Pass EXACTLY ONE of: shiftAllBy (shift every animation/element by N frames), " +
        "staggerBy (re-distribute element entrances N frames apart), or a single-element retiming block (elementId/elementName + startFrame/durationInFrames). " +
        "Use this for: 'the whole reveal is too late, shift it back 15 frames' (shiftAllBy: -15), " +
        "'the elements pop in together, stagger them' (staggerBy: 8), " +
        "'scene 3 needs to last longer' (combine with edit_duration for the scene-level cap), " +
        "'shorten the headline's hold' (elementId + durationInFrames: 30).",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        shiftAllBy: { type: "number", description: "Shift every startFrame by N frames. Negative = earlier." },
        staggerBy: { type: "number", description: "Re-stagger element entrances N frames apart." },
        staggerBaseStartFrame: { type: "number", description: "First element's startFrame in the stagger. Default 0." },
        staggerIncludesAnimations: { type: "boolean", description: "Also stagger each animation's startFrame relative to its element. Default true." },
        scaleDurationsBy: { type: "number", description: "Scale all durations by N (e.g. 0.5 = half as long). Affects elements and their animations." },
        elementId: { type: "string" },
        elementName: { type: "string" },
        startFrame: { type: "number" },
        durationInFrames: { type: "number" },
        animationScale: { type: "number", description: "For single-element retiming: scale each animation's duration by N." },
      },
      required: ["sceneId"],
    },
  },
};

export const editTimingImpl = async (rawArgs: any) => {
  const args = rawArgs as EditTimingArgs;
  if (!args.sceneId) throw new Error("edit_timing: sceneId is required.");

  // Validate that exactly one operation is specified.
  const opCount = [
    args.shiftAllBy !== undefined,
    args.staggerBy !== undefined,
    args.scaleDurationsBy !== undefined,
    args.elementId !== undefined || args.elementName !== undefined,
  ].filter(Boolean).length;

  if (opCount === 0) {
    throw new Error(
      "edit_timing: pass exactly one operation - shiftAllBy, staggerBy, scaleDurationsBy, or elementId/elementName + startFrame/durationInFrames.",
    );
  }
  if (opCount > 1) {
    throw new Error(
      "edit_timing: pass exactly ONE operation, not multiple. Use a separate call for each timing change.",
    );
  }

  // Single-element retiming
  if (args.elementId || args.elementName) {
    return await retimeSingleElement(args);
  }

  // Bulk operations
  return await bulkTimingEdit(args);
};

async function retimeSingleElement(args: EditTimingArgs): Promise<unknown> {
  let result: Record<string, unknown> = {};
  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`edit_timing: scene "${args.sceneId}" not found.`);

    const el = args.elementId
      ? scene.elements.find((e) => e.id === args.elementId)
      : scene.elements.find((e) => e.name === args.elementName);
    if (!el) {
      throw new Error(
        `edit_timing: element "${args.elementId ?? args.elementName}" not found in scene "${args.sceneId}". ` +
          `Available: ${scene.elements.map((e) => `${e.id} ("${e.name}")`).join(", ")}`,
      );
    }

    const changes: string[] = [];
    if (args.startFrame !== undefined) {
      if (args.startFrame < 0) throw new Error("edit_timing: startFrame must be >= 0.");
      el.startFrame = args.startFrame;
      changes.push(`startFrame=${args.startFrame}`);
    }
    if (args.durationInFrames !== undefined) {
      if (args.durationInFrames < 1) throw new Error("edit_timing: durationInFrames must be >= 1.");
      el.durationInFrames = args.durationInFrames;
      changes.push(`durationInFrames=${args.durationInFrames}`);
    }
    if (args.animationScale !== undefined) {
      if (args.animationScale <= 0) throw new Error("edit_timing: animationScale must be > 0.");
      for (const anim of el.animations) {
        anim.durationInFrames = Math.max(1, Math.round(anim.durationInFrames * args.animationScale));
      }
      changes.push(`animations scaled by ${args.animationScale}`);
    }
    result = { ok: true, elementId: el.id, elementName: el.name, changes };
    return draft;
  });
  return result;
}

async function bulkTimingEdit(args: EditTimingArgs): Promise<unknown> {
  const changes: string[] = [];
  let elementsTouched = 0;
  let animationsTouched = 0;
  await sceneStore.update((draft) => {
    const scene = draft.scenes.find((s) => s.id === args.sceneId);
    if (!scene) throw new Error(`edit_timing: scene "${args.sceneId}" not found.`);

    if (args.shiftAllBy !== undefined) {
      const shift = args.shiftAllBy;
      for (const el of scene.elements) {
        el.startFrame = Math.max(0, el.startFrame + shift);
        for (const anim of el.animations) {
          anim.startFrame = Math.max(0, anim.startFrame + shift);
        }
        elementsTouched++;
        animationsTouched += el.animations.length;
      }
      changes.push(`shifted all by ${shift} frames (${elementsTouched} elements, ${animationsTouched} animations)`);
    } else if (args.staggerBy !== undefined) {
      const gap = args.staggerBy;
      const base = args.staggerBaseStartFrame ?? 0;
      const includesAnims = args.staggerIncludesAnimations ?? true;
      // Stagger in element-declaration order (which is the order the
      // elements are listed in the scene). This matches the order
      // plan_scene_layout would have used, and is the most intuitive
      // for the agent.
      scene.elements.forEach((el, index) => {
        const newStart = base + index * gap;
        const delta = newStart - el.startFrame;
        el.startFrame = newStart;
        elementsTouched++;
        if (includesAnims) {
          for (const anim of el.animations) {
            anim.startFrame = Math.max(0, anim.startFrame + delta);
            animationsTouched++;
          }
        }
      });
      changes.push(`staggered ${scene.elements.length} elements by ${gap} frames from base ${base}`);
    } else if (args.scaleDurationsBy !== undefined) {
      const scale = args.scaleDurationsBy;
      if (scale <= 0) throw new Error("edit_timing: scaleDurationsBy must be > 0.");
      for (const el of scene.elements) {
        el.durationInFrames = Math.max(1, Math.round(el.durationInFrames * scale));
        for (const anim of el.animations) {
          anim.durationInFrames = Math.max(1, Math.round(anim.durationInFrames * scale));
        }
        elementsTouched++;
        animationsTouched += el.animations.length;
      }
      changes.push(`scaled durations by ${scale} (${elementsTouched} elements, ${animationsTouched} animations)`);
    }
    return draft;
  });
  return { ok: true, sceneId: args.sceneId, elementsTouched, animationsTouched, changes };
}
