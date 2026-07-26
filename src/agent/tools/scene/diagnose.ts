/**
 * diagnose_scene - root-cause timing-budget analysis for one scene.
 *
 * Why this exists: review_scene flags polish gaps (layering, transitions,
 * timing patterns) but NOT structural timing-budget violations. A common
 * failure mode the user reported: "scene 3 has 3 cards that should
 * stagger in, but only 2 appear before the scene ends". This happens
 * when card 3's startFrame + entrance duration extends past the scene's
 * durationInFrames, so the renderer never paints it. review_scene's
 * polish flags won't catch it because the schedule is technically valid -
 * just overscheduled relative to the runway.
 *
 * diagnose_scene explicitly computes, for every element in a scene:
 *   - the visible window [startFrame, endFrame] including all animations
 *   - whether that window extends past the scene's durationInFrames
 *   - if so, by how many frames, and the smallest fix that closes the gap
 *
 * And for inter-element relationships:
 *   - the gap between consecutive element startFrames
 *   - the cumulative time to last-element-finished vs scene end
 *   - if the user wanted a stagger (N frames between elements) but the
 *     schedule shows a different cadence, surface that
 *
 * Output is structured (not free-form) so the model can mechanically
 * act on it. Each issue includes a `fix` block with the exact tool
 * call the agent should make (e.g. "set element x's startFrame from
 * 280 to 240, scale its animations by 0.7").
 */

import { sceneStore } from "../../../server/sceneStore";

interface DiagnoseSceneArgs {
  sceneId: string;
  /**
   * If set, all timing issues assume the user wanted elements to stagger
   * by this many frames between successive entrances. Helps detect
   * "stagger was 8 but actual gap is 24" — cadence drift the simple
   * flagged-by-window check would miss.
   */
  expectedStaggerFrames?: number;
  /**
   * Recommended extra frames of runway when an element doesn't fit.
   * Default 6 (=0.2s at 30fps) - room for the entrance + a small hold
   * before scene end. Used for the fix-recipe math.
   */
  runwayMarginFrames?: number;
}

interface ElementTiming {
  id: string;
  name: string;
  type: string;
  startFrame: number;
  durationInFrames: number;
  visibleWindow: { start: number; end: number };
  /** Per-animation end times (startFrame + durationInFrames). */
  animationEnds: number[];
  /** The latest frame at which this element does anything visible. */
  latestActivityEnd: number;
  fits: boolean;
  overshoot: number;
}

interface DiagnoseSceneIssue {
  severity: "error" | "warning" | "info";
  category: "clip" | "gap" | "cadence" | "missing-runway" | "stagger-drift";
  message: string;
  /** A concrete fix the agent can apply, including the tool name and
   * suggested args. The agent is not bound to follow it; this is a
   * recommendation so the agent doesn't have to do the math from scratch. */
  fix?: {
    tool: string;
    reason: string;
    suggestedArgs: Record<string, unknown>;
  };
}

interface DiagnoseSceneResult {
  ok: true;
  sceneId: string;
  sceneName: string;
  /** Total scene length. */
  sceneDurationInFrames: number;
  /** Number of visual / animatable elements (excludes pure-audio). */
  elementCount: number;
  /** Per-element timing breakdown. */
  elements: ElementTiming[];
  /** Highest latestActivityEnd across all elements - this is when the
   * scene becomes "featureless". If it extends past sceneDurationInFrames,
   * the scene is overscheduled. */
  sceneLatestActivity: number;
  /** Overshoot relative to scene end (negative = under, positive = past). */
  sceneOvershoot: number;
  issues: DiagnoseSceneIssue[];
  /** A 1-sentence headline the agent can quote to the user. */
  headline: string;
  /** Recommended next tool call as a single string. e.g. "edit_timing with
   * staggerBy:8 or edit_duration:durationInFrames=280". */
  recommendedAction: string;
}

export const diagnoseSceneDef = {
  type: "function",
  function: {
    name: "diagnose_scene",
    description:
      "Run a root-cause timing-budget analysis on ONE scene and surface the specific reason elements get clipped or scenes feel off. " +
      "Use this when the user reports 'element X doesn't appear', 'scene ends before the last animation finishes', 'a card shows up blank', or any visual timing problem where the obvious fixes (edit_timing / set_animation_timing / edit_duration) didn't fix it. " +
      "diagnose_scene explicitly computes per-element visible windows (including ALL animations), checks them against scene.durationInFrames, measures the stagger cadence between successive element startFrames, and produces concrete fix recipes for every issue. " +
      "Returns a structured report with severity-tagged issues, suggested tool calls, and a one-sentence headline you can quote back to the user.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string", description: "The scene to diagnose. Get it from list_scenes." },
        expectedStaggerFrames: { type: "number", description: "If the user implied a stagger cadence (e.g. 'each card 12 frames after the previous'), pass that value here. Defaults to 0 - no expected cadence." },
        runwayMarginFrames: { type: "number", description: "Recommended extra frames of safety margin past the latest activity (default 6, ~0.2s at 30fps). Used in the fix-recipe math." },
      },
      required: ["sceneId"],
    },
  },
};

interface RawElement {
  id: string;
  type: string;
  name?: string;
  startFrame?: number;
  durationInFrames?: number;
  animations?: Array<{
    id?: string;
    property?: string;
    startFrame?: number;
    durationInFrames?: number;
  }>;
}

function computeElementTiming(el: RawElement): ElementTiming {
  const startFrame = el.startFrame ?? 0;
  const duration = el.durationInFrames ?? 0;
  const elementEnd = startFrame + duration;
  const animationEnds = Array.isArray(el.animations)
    ? el.animations
        .map((a) => (a.startFrame ?? 0) + (a.durationInFrames ?? 0))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const latest = Math.max(elementEnd, ...animationEnds);
  return {
    id: el.id,
    name: el.name ?? el.id,
    type: el.type,
    startFrame,
    durationInFrames: duration,
    visibleWindow: { start: startFrame, end: elementEnd },
    animationEnds,
    latestActivityEnd: latest,
    fits: latest <= elementEnd, // trivially true if no animations extend past element end
    overshoot: 0, // computed against scene end later
  };
}

export const diagnoseSceneImpl = async (rawArgs: unknown): Promise<DiagnoseSceneResult> => {
  const args = rawArgs as DiagnoseSceneArgs;
  if (!args.sceneId) throw new Error("diagnose_scene: sceneId is required.");
  const runway = args.runwayMarginFrames ?? 6;

  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === args.sceneId);
  if (!scene) {
    const known = composition.scenes.map((s) => s.id).join(", ");
    throw new Error(
      `diagnose_scene: scene "${args.sceneId}" not found. Existing scene ids: ${known || "(none)"}`,
    );
  }

  const sceneDuration = scene.durationInFrames;

  // Only consider visual / animatable element types (not audio).
  const ANIMATABLE_TYPES = new Set(["text", "image", "video", "shape", "custom", "line"]);
  const elements = (scene.elements as RawElement[])
    .filter((el) => ANIMATABLE_TYPES.has(el.type))
    .map(computeElementTiming);

  // Stage 1: per-element window overflow relative to scene end.
  for (const t of elements) {
    t.overshoot = t.latestActivityEnd - sceneDuration;
    t.fits = t.overshoot <= 0;
  }

  // Stage 2: scene-level latest activity.
  const sceneLatestActivity = elements.reduce((m, t) => Math.max(m, t.latestActivityEnd), 0);
  const sceneOvershoot = sceneLatestActivity - sceneDuration;

  const issues: DiagnoseSceneIssue[] = [];

  // 2a: per-element clip issues
  for (const t of elements) {
    if (t.overshoot <= runway) continue;
    const neededExtra = Math.max(0, t.latestActivityEnd + runway - sceneDuration);
    issues.push({
      severity: "error",
      category: "clip",
      message:
        `${t.name} (${t.type}, id "${t.id}") finishes its visible work at frame ` +
        `${t.latestActivityEnd}, but the scene ends at frame ${sceneDuration}. ` +
        `It will be clipped: ${t.overshoot} frames of activity past scene end.`,
      fix: {
        tool: "edit_duration",
        reason:
          `Extend the scene to fit the element's latest activity plus a ${runway}-frame margin. ` +
          `Smaller alternative: edit_timing staggerIncludesAnimations:true to compress the schedule.`,
        suggestedArgs: { sceneId: scene.id, durationInFrames: sceneDuration + neededExtra },
      },
    });
  }

  // 2b: scene-level overschedule
  if (sceneOvershoot > runway && issues.filter((i) => i.category === "clip").length === 0) {
    issues.push({
      severity: "warning",
      category: "missing-runway",
      message:
        `No single element overshoots, but the scene's latest-activity frame is ${sceneLatestActivity} ` +
        `which is ${sceneOvershoot} frames past scene end (${sceneDuration}). Likely animation-only overshoot.`,
      fix: {
        tool: "edit_duration",
        reason: "Pull the scene end out to the latest activity + margin.",
        suggestedArgs: { sceneId: scene.id, durationInFrames: sceneLatestActivity + runway },
      },
    });
  }

  // 2c: stagger cadence drift
  if (elements.length >= 2 && typeof args.expectedStaggerFrames === "number" && args.expectedStaggerFrames > 0) {
    const sorted = [...elements].sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 1; i < sorted.length; i++) {
      const actualGap = sorted[i].startFrame - sorted[i - 1].startFrame;
      const drift = actualGap - args.expectedStaggerFrames;
      if (Math.abs(drift) > 1) {
        const ordered = sorted.map((e) => e.name).join(" → ");
        issues.push({
          severity: drift > 0 ? "warning" : "info",
          category: "stagger-drift",
          message:
            `Stagger cadence drift: ${sorted[i - 1].name} → ${sorted[i].name} is ${actualGap}f apart, ` +
            `expected ${args.expectedStaggerFrames}f (drift ${drift > 0 ? "+" : ""}${drift}f). ` +
            `Element order: ${ordered}.`,
          fix: {
            tool: "edit_timing",
            reason: "Re-stagger with edit_timing.staggerBy to lock the cadence.",
            suggestedArgs: {
              sceneId: scene.id,
              staggerBy: args.expectedStaggerFrames,
              staggerBaseStartFrame: sorted[0].startFrame,
              staggerIncludesAnimations: true,
            },
          },
        });
      }
    }
  }

  // 2d: inter-element gaps (no element-level constraint; just info)
  if (elements.length >= 2) {
    const sorted = [...elements].sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].latestActivityEnd;
      const currentStart = sorted[i].startFrame;
      if (currentStart < prevEnd && sorted[i - 1].overshoot <= 0) {
        // The previous element is still active when this one starts.
        // Not always a bug (intended overlap) but worth flagging when
        // the user said "appear one after another".
        issues.push({
          severity: "info",
          category: "gap",
          message:
            `${sorted[i - 1].name} is still animating until frame ${prevEnd} when ` +
            `${sorted[i].name} starts at frame ${currentStart}. ` +
            `${prevEnd - currentStart} frames of overlap (may be intentional).`,
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const headline =
    errorCount > 0
      ? `${errorCount} element${errorCount === 1 ? "" : "s"} clipped at scene end (overshoot ${sceneOvershoot}f).`
      : warningCount > 0
        ? `No clipping, but ${warningCount} cadence / runway warning${warningCount === 1 ? "" : "s"}.`
        : `Timing fits the runway.`;

  const recommendedAction =
    errorCount > 0
      ? `edit_duration with durationInFrames=${sceneDuration + Math.max(0, sceneOvershoot) + runway} (or shorter via edit_timing scaleDurationsBy).`
      : warningCount > 0
        ? `review the cadence warnings below and call edit_timing as suggested.`
        : `no fix needed - proceed to render or to the next scene.`;

  return {
    ok: true,
    sceneId: scene.id,
    sceneName: scene.name,
    sceneDurationInFrames: sceneDuration,
    elementCount: elements.length,
    elements,
    sceneLatestActivity,
    sceneOvershoot,
    issues,
    headline,
    recommendedAction,
  };
};
