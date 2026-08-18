import { sceneStore } from "../../../server/sceneStore";
import {
  getSceneStartFrames,
  collectCompositionTimingIssues,
  totalDurationInFrames,
  type Composition,
} from "../../../schema/scene";

/**
 * timeline_overview — error.txt item 8.
 *
 * After building 12 scenes, the agent had to mentally compute "scene 1 =
 * 0-150, scene 2 = 150-300, ..." to know the project's pacing. This tool
 * gives back the full timeline at a glance: total duration, per-scene
 * start/end frames, transition type per boundary, and any scenes that
 * need attention (no visible content at frame 0, suspicious element
 * counts, etc).
 */
export const timelineOverviewDef = {
  type: "function",
  function: {
    name: "timeline_overview",
    description:
      "Get a high-level summary of the whole composition: total duration in frames and seconds, each scene's start frame / end frame / duration / element count, the transition type at every scene boundary, and any pacing/visibility flags worth fixing. Call this AFTER building your last scene but BEFORE doing a full render - it's the 'take a breath and check the rhythm' step. Complements review_scene (which is per-scene detail) by giving you the whole project at once.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const diagnoseCompositionDef = {
  type: "function",
  function: {
    name: "diagnose_composition",
    description:
      "Run a project-wide timing and layer sanity check. Returns exact scene ranges, element/animation overflows, transitions that are too long, duplicate ids, and visible layer overlaps. Call this before and after major scene-building or timeline edits; fix errors before declaring the video ready.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export type TimelineOverviewResult = {
  totalFrames: number;
  totalSeconds: number;
  sceneCount: number;
  fps: number;
  orientation: string;
  scenes: Array<{
    index: number;
    id: string;
    name: string;
    startFrame: number;
    endFrame: number;
    durationInFrames: number;
    durationSeconds: number;
    elementCount: number;
    visibleAtFrame0: boolean;
    transitionIn: { type: string; direction?: string; durationInFrames?: number } | null;
  }>;
  transitions: Array<{
    fromSceneName: string;
    fromSceneId: string;
    toSceneName: string;
    toSceneId: string;
    type: string;
    direction?: string;
    durationInFrames?: number;
  }>;
  pacingNotes: string[];
  timingIssues: ReturnType<typeof collectCompositionTimingIssues>;
};

export async function timelineOverviewImpl(_args: Record<string, unknown> = {}): Promise<TimelineOverviewResult> {
  const composition: Composition = sceneStore.get();

  const starts = getSceneStartFrames(composition);
  const scenes: TimelineOverviewResult["scenes"] = [];
  const transitions: TimelineOverviewResult["transitions"] = [];

  composition.scenes.forEach((scene, i) => {
    const startFrame = starts[i] ?? 0;
    const endFrame = startFrame + scene.durationInFrames;
    const visualElements = scene.elements.filter(
      (el) => el.type !== "audio",
    );
    const visibleAtFrame0 = visualElements.some(
      (el) => el.startFrame === 0 && (el.opacity ?? 1) > 0,
    );

    scenes.push({
      index: i,
      id: scene.id,
      name: scene.name,
      startFrame,
      endFrame,
      durationInFrames: scene.durationInFrames,
      durationSeconds: Number((scene.durationInFrames / composition.fps).toFixed(2)),
      elementCount: visualElements.length,
      visibleAtFrame0,
      transitionIn: scene.transitionIn ?? null,
    });

    if (i > 0 && scene.transitionIn) {
      transitions.push({
        fromSceneName: composition.scenes[i - 1].name,
        fromSceneId: composition.scenes[i - 1].id,
        toSceneName: scene.name,
        toSceneId: scene.id,
        type: scene.transitionIn.type,
        direction: scene.transitionIn.direction,
        durationInFrames: scene.transitionIn.durationInFrames,
      });
    }

  });

  const totalFrames = totalDurationInFrames(composition);
  const timingIssues = collectCompositionTimingIssues(composition);

  const pacingNotes: string[] = [];

  if (composition.scenes.length === 0) {
    pacingNotes.push("Project is empty - no scenes to render.");
  }

  if (transitions.length === 0 && composition.scenes.length > 1) {
    pacingNotes.push(
      "No transitions set between any scenes - the video will hard-cut from one scene to the next. Consider set_scene_transition on each scene after the first (or set_all_transitions) for a more polished look.",
    );
  }

  // Flag scenes that are invisible at frame 0
  const invisibleAtStart = scenes.filter((s) => s.elementCount > 0 && !s.visibleAtFrame0);
  if (invisibleAtStart.length > 0) {
    pacingNotes.push(
      `${invisibleAtStart.length} scene(s) have content but nothing visible at frame 0: ` +
        invisibleAtStart.map((s) => `"${s.name}"`).join(", ") +
        `. The first ${invisibleAtStart[0].durationSeconds}s of each will look blank before the content appears.`,
    );
  }

  // Flag uneven pacing: any scene >2x or <0.5x the median duration suggests
  // a pacing inconsistency the user may want to know about.
  if (scenes.length >= 3) {
    const durations = scenes.map((s) => s.durationInFrames).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    const outliers = scenes.filter(
      (s) => s.durationInFrames > median * 2 || s.durationInFrames < median * 0.5,
    );
    if (outliers.length > 0 && median > 0) {
      pacingNotes.push(
        `Pacing outlier(s) - scene duration varies by more than 2x from the median (${(median / composition.fps).toFixed(1)}s): ` +
          outliers
            .map((s) => `"${s.name}" ${s.durationSeconds}s`)
            .join(", ") +
          `. If this is intentional, ignore. Otherwise, call update_scene to bring them closer.`,
      );
    }
  }

  // Flag very short scenes (< 1s) - often a mistake.
  const veryShort = scenes.filter((s) => s.durationInFrames < composition.fps);
  if (veryShort.length > 0) {
    pacingNotes.push(
      `Very short scene(s) (<1s): ` +
        veryShort.map((s) => `"${s.name}" ${s.durationSeconds}s`).join(", ") +
        `. May flash by too fast to read.`,
    );
  }

  if (timingIssues.length > 0) {
    pacingNotes.push(
      `${timingIssues.length} timing issue(s) detected. ` +
        `Run diagnose_composition to see exact scene/element frames and fixes.`,
    );
  }

  return {
    totalFrames,
    totalSeconds: Number((totalFrames / composition.fps).toFixed(2)),
    sceneCount: composition.scenes.length,
    fps: composition.fps,
    orientation: composition.orientation,
    scenes,
    transitions,
    pacingNotes,
    timingIssues,
  };
}

export async function diagnoseCompositionImpl(): Promise<{
  totalFrames: number;
  totalSeconds: number;
  sceneRanges: Array<{
    sceneId: string;
    name: string;
    startFrame: number;
    endFrame: number;
  }>;
  issues: ReturnType<typeof collectCompositionTimingIssues>;
}> {
  const overview = await timelineOverviewImpl();
  return {
    totalFrames: overview.totalFrames,
    totalSeconds: overview.totalSeconds,
    sceneRanges: overview.scenes.map((scene) => ({
      sceneId: scene.id,
      name: scene.name,
      startFrame: scene.startFrame,
      endFrame: scene.endFrame,
    })),
    issues: overview.timingIssues,
  };
}
