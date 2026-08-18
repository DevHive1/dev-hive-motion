import { z } from "zod";

/**
 * Single source of truth for video composition JSON structure.
 * AI agent, Remotion renderer, and editor UI all use this exact schema.
 */

export const AnimatableProperty = z.enum([
  "opacity",
  "x",
  "y",
  "scale",
  "rotation",
]);

export const Easing = z.enum([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "spring",    // Overshoot then settle — great for icon pops
  "bounce",    // Bounces at the end like a ball hitting the floor
  "elastic",   // Snaps past target and oscillates back
]);

export const AnimationSchema = z.object({
  id: z.string(),
  property: AnimatableProperty,
  from: z.number(),
  to: z.number(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  easing: Easing.default("easeInOut"),
  // Loop support: loop:true repeats the animation indefinitely within the element's duration.
  // loopCount: 0 = infinite, N = repeat N times after the first play.
  loop: z.boolean().optional(),
  loopCount: z.number().int().min(0).optional(),
});

// CSS mix-blend-mode values available for layering effects
export const BlendMode = z.enum([
  "normal", "multiply", "screen", "overlay",
  "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
]);

const BaseElementFields = {
  id: z.string(),
  name: z.string().default("Untitled element"),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(40),
  height: z.number().default(20),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  zIndex: z.number().default(0),
  startFrame: z.number().min(0).default(0),
  durationInFrames: z.number().min(1).default(150),
  animations: z.array(AnimationSchema).default([]),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  // CSS mix-blend-mode for compositing with layers below
  mixBlendMode: BlendMode.optional(),
};

export const GradientSchema = z.object({
  from: z.string(),
  to: z.string(),
  angleDeg: z.number().default(135),
});

export const TextElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("text"),
  text: z.string().default("New text"),
  fontSize: z.number().default(48),
  fontFamily: z.string().default("Inter"),
  fontWeight: z.number().default(600),
  color: z.string().default("#ffffff"),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  letterSpacing: z.number().default(0),
  // textShadow accepts true (uses default soft shadow), false/undefined (none),
  // or a raw CSS shadow string e.g. "0 4px 24px rgba(0,0,0,0.8)".
  textShadow: z.union([z.boolean(), z.string()]).default(false),
  highlightColor: z.string().optional(),
  // Text stroke (outline). strokeWidth in px, strokeColor in any CSS color.
  strokeColor: z.string().optional(),
  strokeWidth: z.number().default(0),
  // Text gradient — overrides `color` when set.
  gradient: GradientSchema.optional(),
});

export const ImageElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("image"),
  src: z.string().default(""),
  objectFit: z.enum(["cover", "contain", "fill"]).default("cover"),
  borderRadius: z.number().default(0),
  boxShadow: z.string().optional(),
});

export const VideoElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("video"),
  src: z.string().default(""),
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
  objectFit: z.enum(["cover", "contain", "fill"]).default("cover"),
  playbackRate: z.number().default(1),
});

export const ShapeElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "circle", "line", "border"]).default("rectangle"),
  fill: z.string().default("#D97757"),
  gradient: GradientSchema.optional(),
  borderRadius: z.number().default(0),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().default(0),
  blurPx: z.number().default(0),
  backdropBlurPx: z.number().default(0),
  boxShadow: z.string().optional(),
});

export const CustomElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("custom"),
  html: z.string().default(""),
  css: z.string().default(""),
  js: z.string().optional(),
  transparentBackground: z.boolean().default(true),
});

export const AudioElementSchema = z.object({
  ...BaseElementFields,
  type: z.literal("audio"),
  src: z.string().default(""),
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
});

export const SceneElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ImageElementSchema,
  VideoElementSchema,
  ShapeElementSchema,
  CustomElementSchema,
  AudioElementSchema,
]);

export const TransitionType = z.enum([
  // Plain cut-through (no transition) or gentle cross.
  "fade",
  "none",
  // Directional reveals.
  "slide",
  "wipe",
  "flip",
  "clockWipe",
  // Cross-cutting that uses an effect.
  "dissolve",
  "crossZoom",
  "dreamyZoom",
  "filmBurn",
  "zoomBlur",
  "zoomInOut",
  // Geometric shapes.
  "iris",
  "ripple",
  "swap",
  // Soft distortion transitions.
  "linearBlur",
]);
export const TransitionDirection = z.enum(["from-left", "from-right", "from-top", "from-bottom"]);

export const TransitionSchema = z.object({
  type: TransitionType.default("fade"),
  direction: TransitionDirection.default("from-right"),
  durationInFrames: z.number().min(1).default(15),
});

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string().default("Untitled scene"),
  durationInFrames: z.number().min(1).default(150),
  backgroundColor: z.string().default("#0b0b0f"),
  elements: z.array(SceneElementSchema).default([]),
  transitionIn: TransitionSchema.optional(),
  transitionOut: TransitionSchema.optional(),
  locked: z.boolean().default(false),
  solo: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});

export const StoryboardSceneSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  narrativeBeat: z.string().default(""),
  contentNotes: z.string().default(""),
  keyElements: z.string(),
  transitionNote: z.string().default(""),
  animationNote: z.string().default(""),
  // Per-scene production specs. These are guidance, not constraints - the
  // storyboard is a planning document, and the actual values come from
  // plan_scene_layout. The point is that the agent commits to a visual
  // and timing direction per scene BEFORE building, instead of inventing
  // them on the fly per element.
  shotType: z
    .enum(["establishing", "wide", "medium", "closeUp", "detail"])
    .optional(),
  visualTreatment: z.string().default(""),
  targetDurationInFrames: z.number().optional(),
  entranceCue: z.string().default(""),
  audioCue: z
    .object({
      kind: z.enum(["voiceover", "music", "sfx", "silence"]),
      description: z.string(),
      startFrame: z.number().optional(),
    })
    .optional(),
  dependencies: z.array(z.string()).default([]),
});

/**
 * Structured design language the storyboard commits to up front, so
 * the model has a concrete reference for color/type/margin instead of
 * having to remember prose mood across 12 scenes. Each scene then
 * references this via plan_scene_layout's designTokens.
 */
export const DesignLanguageSchema = z.object({
  // 2-4 named colors in hex. The first is the dominant field, the
  // remaining are accents/text. Don't pass more than 4 - palette
  // discipline is enforced in plan_scene_layout.
  palette: z.array(z.string()).default([]),
  // One display font and one body font, by family name. e.g.
  // { display: "Manrope", body: "Inter" }.
  typePair: z
    .object({
      display: z.string(),
      body: z.string(),
    })
    .default({ display: "Inter", body: "Inter" }),
  // Margin in percent from the canvas edge. e.g. 8 means everything
  // sits at least 8% from any edge. plan_scene_layout will snap
  // element edges to this margin.
  margin: z.number().min(0).max(20).default(8),
  // Suggested type sizes for display/headline, body, and kicker in
  // a consistent ratio. e.g. { display: 72, body: 28, kicker: 18 }.
  typeScale: z
    .object({
      display: z.number(),
      body: z.number(),
      kicker: z.number(),
    })
    .default({ display: 72, body: 28, kicker: 18 }),
  // Named motion vocabulary the project uses. e.g.
  // ["fade-up", "fade-in", "ken-burns"].
  motionVocabulary: z.array(z.string()).default([]),
});

/**
 * Creative brief at the top of the storyboard: who's it for, where
 * will it play, how long, what aspect ratio. Without this the agent
 * guesses - usually wrong - and ends up making corporate explainer
 * motion at 4:3 for a TikTok request, or 9:16 vertical for a
 * YouTube hero.
 */
export const CreativeBriefSchema = z.object({
  targetAudience: z.string().default(""),
  platform: z.string().default(""),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "21:9"]).optional(),
  targetDurationSeconds: z.number().optional(),
  genre: z
    .enum([
      "corporate",
      "social-reel",
      "documentary",
      "cinematic",
      "kids",
      "product-launch",
      "educational",
      "other",
    ])
    .default("other"),
  designLanguage: DesignLanguageSchema.optional(),
});

export const StoryboardSchema = z.object({
  title: z.string(),
  concept: z.string(),
  narrativeArc: z.string().default(""),
  moodDirection: z.string(),
  brief: CreativeBriefSchema.optional(),
  scenes: z.array(StoryboardSceneSchema).default([]),
});

export const OrientationPreset = z.enum(["landscape", "portrait", "square"]);

export const CompositionSchema = z.object({
  id: z.string().default("main"),
  name: z.string().default("Untitled project"),
  version: z.number().default(2),
  fps: z.number().default(30),
  width: z.number().default(1920),
  height: z.number().default(1080),
  orientation: OrientationPreset.default("landscape"),
  scenes: z.array(SceneSchema).default([]),
  globalAudio: z.array(AudioElementSchema).default([]),
  storyboard: StoryboardSchema.optional(),
  metadata: z
    .object({
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      durationSeconds: z.number().optional(),
    })
    .default({}),
});

export type TransitionType = z.infer<typeof TransitionType>;
export type TransitionDirection = z.infer<typeof TransitionDirection>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Gradient = z.infer<typeof GradientSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type VideoElement = z.infer<typeof VideoElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type CustomElement = z.infer<typeof CustomElementSchema>;
export type AudioElement = z.infer<typeof AudioElementSchema>;
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;
export type Storyboard = z.infer<typeof StoryboardSchema>;
export type DesignLanguage = z.infer<typeof DesignLanguageSchema>;
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
export type SceneElement = z.infer<typeof SceneElementSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Composition = z.infer<typeof CompositionSchema>;

/**
 * The renderer uses transition overlaps when laying scenes out in global
 * composition time. Keep this calculation in the schema module so the
 * renderer, timeline, diagnostics and agent all agree on the same clock.
 */
export function getSceneStartFrames(composition: Composition): number[] {
  const starts: number[] = [];
  let cursor = 0;

  composition.scenes.forEach((scene, index) => {
    const incomingOverlap =
      index > 0 && scene.transitionIn?.type !== "none"
        ? scene.transitionIn?.durationInFrames ?? 0
        : 0;
    const start = Math.max(0, cursor - incomingOverlap);
    starts.push(start);
    cursor = start + scene.durationInFrames;
  });

  return starts;
}

export function getSceneStartFrame(composition: Composition, sceneId: string): number {
  const index = composition.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return 0;
  return getSceneStartFrames(composition)[index] ?? 0;
}

export type CompositionTimingIssue = {
  code:
    | "empty-composition"
    | "empty-scene"
    | "transition-too-long"
    | "element-overflow"
    | "animation-overflow"
    | "element-before-scene"
    | "scene-too-short"
    | "duplicate-element-id"
    | "layer-overlap";
  severity: "error" | "warning";
  sceneId?: string;
  elementId?: string;
  message: string;
  suggestedFix?: string;
};

/**
 * Deterministic project-wide timing validation. This deliberately reports
 * intentional short clips as warnings, while impossible ranges and clipped
 * animations are errors. It is used by both the UI diagnostics and the agent.
 */
export function collectCompositionTimingIssues(
  composition: Composition,
): CompositionTimingIssue[] {
  const issues: CompositionTimingIssue[] = [];

  if (composition.scenes.length === 0) {
    issues.push({
      code: "empty-composition",
      severity: "warning",
      message: "The composition has no scenes.",
      suggestedFix: "Add at least one scene before rendering.",
    });
    return issues;
  }

  const seenElementIds = new Set<string>();
  composition.scenes.forEach((scene) => {
    if (scene.durationInFrames < composition.fps) {
      issues.push({
        code: "scene-too-short",
        severity: "warning",
        sceneId: scene.id,
        message: `Scene "${scene.name}" is only ${scene.durationInFrames} frames long.`,
        suggestedFix: "Extend the scene to at least one second unless the flash is intentional.",
      });
    }
    if (scene.elements.length === 0) {
      issues.push({
        code: "empty-scene",
        severity: "warning",
        sceneId: scene.id,
        message: `Scene "${scene.name}" has no visual elements.`,
        suggestedFix: "Add a background or visual element, or remove the scene.",
      });
    }
    if (
      scene.transitionIn &&
      scene.transitionIn.type !== "none" &&
      scene.transitionIn.durationInFrames >= scene.durationInFrames
    ) {
      issues.push({
        code: "transition-too-long",
        severity: "error",
        sceneId: scene.id,
        message: `Scene "${scene.name}" transition (${scene.transitionIn.durationInFrames}f) is as long as the scene (${scene.durationInFrames}f).`,
        suggestedFix: "Shorten the transition or extend the scene.",
      });
    }

    scene.elements.forEach((element) => {
      if (seenElementIds.has(element.id)) {
        issues.push({
          code: "duplicate-element-id",
          severity: "error",
          sceneId: scene.id,
          elementId: element.id,
          message: `Element id "${element.id}" is duplicated across the composition.`,
          suggestedFix: "Give each element a unique id so selection and edits are unambiguous.",
        });
      }
      seenElementIds.add(element.id);

      if (element.startFrame < 0) {
        issues.push({
          code: "element-before-scene",
          severity: "error",
          sceneId: scene.id,
          elementId: element.id,
          message: `"${element.name}" starts before frame 0.`,
          suggestedFix: "Set startFrame to 0 or a positive local frame.",
        });
      }

      const elementEnd = element.startFrame + element.durationInFrames;
      if (elementEnd > scene.durationInFrames) {
        issues.push({
          code: "element-overflow",
          severity: "error",
          sceneId: scene.id,
          elementId: element.id,
          message: `"${element.name}" ends at frame ${elementEnd}, past scene end ${scene.durationInFrames}.`,
          suggestedFix: "Extend the scene or shorten/retime the element.",
        });
      }

      element.animations.forEach((animation) => {
        const animationEnd = animation.startFrame + animation.durationInFrames;
        if (animationEnd > element.durationInFrames) {
          issues.push({
            code: "animation-overflow",
            severity: "error",
            sceneId: scene.id,
            elementId: element.id,
            message: `Animation "${animation.property}" on "${element.name}" ends at element frame ${animationEnd}, past its ${element.durationInFrames}f clip.`,
            suggestedFix: "Retiming the animation or extending the element duration will prevent the tail from being clipped.",
          });
        }
      });
    });

    for (let i = 0; i < scene.elements.length; i++) {
      for (let j = i + 1; j < scene.elements.length; j++) {
        const a = scene.elements[i];
        const b = scene.elements[j];
        const timeOverlaps =
          a.startFrame < b.startFrame + b.durationInFrames &&
          b.startFrame < a.startFrame + a.durationInFrames;
        if (!timeOverlaps) continue;

        const overlapWidth = Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
        if (overlapWidth === 0 || overlapHeight === 0) continue;

        const [lower, higher] = a.zIndex <= b.zIndex ? [a, b] : [b, a];
        const higherCanHideText =
          higher.type !== "text" && lower.type === "text";
        const sameBounds =
          Math.abs(a.x - b.x) < 0.5 &&
          Math.abs(a.y - b.y) < 0.5 &&
          Math.abs(a.width - b.width) < 0.5 &&
          Math.abs(a.height - b.height) < 0.5;

        if (higherCanHideText || (sameBounds && a.zIndex === b.zIndex)) {
          issues.push({
            code: "layer-overlap",
            severity: higherCanHideText ? "error" : "warning",
            sceneId: scene.id,
            elementId: higher.id,
            message: higherCanHideText
              ? `"${higher.name}" overlaps the text "${lower.name}" and is stacked above it.`
              : `"${a.name}" and "${b.name}" occupy the same bounds at the same layer.`,
            suggestedFix: higherCanHideText
              ? `Raise "${lower.name}" above "${higher.name}" or move the elements apart.`
              : "Move one element, resize it, or assign a deliberate layer order.",
          });
        }
      }
    }
  });

  return issues;
}

export function totalDurationInFrames(composition: Composition): number {
  if (composition.scenes.length === 0) return 1;
  const starts = getSceneStartFrames(composition);
  const lastIndex = composition.scenes.length - 1;
  return Math.max(
    1,
    (starts[lastIndex] ?? 0) + composition.scenes[lastIndex].durationInFrames,
  );
}

export function getPresetDimensions(preset: z.infer<typeof OrientationPreset>): { width: number; height: number } {
  switch (preset) {
    case "portrait":
      return { width: 1080, height: 1920 };
    case "square":
      return { width: 1080, height: 1080 };
    case "landscape":
    default:
      return { width: 1920, height: 1080 };
  }
}

export function emptyComposition(): Composition {
  return CompositionSchema.parse({
    id: "main",
    name: "New project",
    version: 2,
    orientation: "landscape",
    scenes: [],
  });
}
