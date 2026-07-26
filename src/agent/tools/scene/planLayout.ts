/**
 * plan_scene_layout - the "blueprint" tool.
 *
 * The agent's job before building a scene: describe what should be on
 * screen and where. This tool computes exact x/y from relative
 * positioning, applies the project's design language (palette, type
 * scale, margin grid), and returns a fully-resolved blueprint plus
 * polish-flag previews - so the agent knows whether the scene it just
 * designed would trigger review_scene warnings, BEFORE building it.
 *
 * Curated preset roles (headline, subtitle, kicker, body, statNumber,
 * ctaButton, etc.) carry professional defaults so the agent doesn't
 * have to invent sizes per scene. Alignment helpers (left, centerX,
 * right, top, centerY, bottom, plus alignTo:'canvas'|'role') replace
 * the old "give me x/y" pattern for the common case.
 *
 * Design tokens (margin, palette, typeScale) are passed in once per
 * call (or read from the current storyboard's brief) and snap all
 * elements to them. This is what makes the 8% margin / 2-4 palette /
 * display-to-body type ratio from the design playbook actually hold
 * across scenes - it's enforced here, not just "remembered."
 */

import type { LayoutBox } from "../../layoutCheck";
import { computeLayoutFlags, analyzePolish, polishFlagStrings } from "../../layoutCheck";
import type { PolishFlags } from "../../layoutCheck";
import type { DesignLanguage, Storyboard } from "../../../schema/scene";
import { sceneStore } from "../../../server/sceneStore";

// ─── Types ────────────────────────────────────────────────────────────

export type Relation =
  | "below"
  | "above"
  | "leftOf"
  | "rightOf"
  | "sameSpot"
  | "centerXOn"
  | "centerYOn"
  | "alignedLeft"
  | "alignedRight"
  | "alignedTop"
  | "alignedBottom";

export type Alignment =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export type PresetRole =
  | "headline"
  | "subtitle"
  | "kicker"
  | "body"
  | "caption"
  | "statNumber"
  | "statLabel"
  | "ctaButton"
  | "backgroundPanel"
  | "backgroundImage"
  | "imageHero"
  | "imageSecondary"
  | "icon"
  | "divider"
  | "logo";

export type AnimationPlan = "stagger" | "wave" | "burst" | "sequential";

export type ColorRole =
  | "primary"
  | "secondary"
  | "accent"
  | "surface"
  | "onPrimary"
  | "onSurface"
  | "background";

export interface PlanElementSpec {
  role: string;
  type: "text" | "image" | "video" | "shape" | "custom" | "audio";
  presetRole?: PresetRole;
  width: number;
  height: number;
  x?: number;
  y?: number;
  relativeTo?: string;
  relation?: Relation;
  gap?: number;
  zIndex?: number;
  startFrame?: number;
  durationInFrames?: number;
  // Alignment: when set, this element's edge snaps to the canvas edge
  // or the named reference's matching edge. Overrides x/y for that axis.
  align?: Alignment;
  alignTo?: "canvas" | string; // 'canvas' or a role
  // Text styling pre-fill. When presetRole is a text type and these
  // are not given, they're filled from designTokens.typeScale.
  textStyle?: {
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: "display" | "body" | string;
    textAlign?: "left" | "center" | "right";
    letterSpacing?: number;
  };
  // Color role from the design language. Resolved to a hex by the tool
  // and returned in the resolved element so the agent doesn't have to
  // look up the palette itself.
  colorRole?: ColorRole;
  // For shape elements: which design-token color to use as fill.
  fillColorRole?: ColorRole;
}

export interface PlanSceneLayoutArgs {
  elements: PlanElementSpec[];
  // When provided, the layout tool snaps everything to these design
  // tokens. Typically read from the storyboard's brief.designLanguage.
  designTokens?: DesignLanguage;
  // Animation timing pattern. When set, startFrames are auto-computed
  // for each element in declaration order, and any explicit startFrame
  // on an element is overridden.
  animationPlan?: AnimationPlan;
  // Stagger/delay between elements in frames, used by stagger/wave.
  animationStagger?: number;
  // How long each entrance takes, in frames. Default 18.
  animationDuration?: number;
  // Easing for auto-generated entrance animations. Default 'easeOut'.
  animationEasing?:
    | "linear"
    | "easeIn"
    | "easeOut"
    | "easeInOut"
    | "circOut"
    | "backOut";
  // Scene-level metadata used for the polish preview.
  backgroundColor?: string;
  transitionIn?: { type: string; durationInFrames?: number } | null;
  previousTransitionIn?: { type: string; durationInFrames?: number } | null;
  hasNextScene?: boolean;
}

export interface ResolvedElement {
  role: string;
  type: string;
  presetRole?: PresetRole;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  startFrame: number;
  durationInFrames?: number;
  // Optional style pre-fill, returned so build_scene can pass them
  // through without the agent re-specifying.
  textStyle?: PlanElementSpec["textStyle"];
  color?: string; // resolved hex from colorRole
  fillColor?: string; // resolved hex from fillColorRole
  // Auto-generated entrance animations for build_scene to copy into its
  // elements[].animations array. When animationPlan is set, every visual
  // element gets one. Audio elements don't get entrance animations.
  animations: Array<Record<string, unknown>>;
}

// ─── Defaults from preset roles ────────────────────────────────────────

interface PresetDefaults {
  type: PlanElementSpec["type"];
  /** default width as a percent of canvas (0-100) */
  defaultWidth: number;
  /** default height as a percent of canvas */
  defaultHeight: number;
  /** default text style for text-type presets */
  textStyle?: PlanElementSpec["textStyle"];
}

const PRESET_DEFAULTS: Record<PresetRole, PresetDefaults> = {
  headline: { type: "text", defaultWidth: 80, defaultHeight: 12, textStyle: { fontWeight: 700, textAlign: "center" } },
  subtitle: { type: "text", defaultWidth: 70, defaultHeight: 6, textStyle: { fontWeight: 500, textAlign: "center" } },
  kicker: { type: "text", defaultWidth: 40, defaultHeight: 3, textStyle: { fontWeight: 600, textAlign: "center", letterSpacing: 1.5 } },
  body: { type: "text", defaultWidth: 60, defaultHeight: 18, textStyle: { fontWeight: 400, textAlign: "center" } },
  caption: { type: "text", defaultWidth: 50, defaultHeight: 3, textStyle: { fontWeight: 400, textAlign: "center" } },
  statNumber: { type: "text", defaultWidth: 40, defaultHeight: 14, textStyle: { fontWeight: 800, textAlign: "center" } },
  statLabel: { type: "text", defaultWidth: 40, defaultHeight: 3, textStyle: { fontWeight: 500, textAlign: "center", letterSpacing: 1 } },
  ctaButton: { type: "shape", defaultWidth: 28, defaultHeight: 6 },
  backgroundPanel: { type: "shape", defaultWidth: 84, defaultHeight: 60 },
  backgroundImage: { type: "image", defaultWidth: 100, defaultHeight: 100 },
  imageHero: { type: "image", defaultWidth: 70, defaultHeight: 50 },
  imageSecondary: { type: "image", defaultWidth: 35, defaultHeight: 25 },
  icon: { type: "custom", defaultWidth: 8, defaultHeight: 8 },
  divider: { type: "shape", defaultWidth: 60, defaultHeight: 0.3 },
  logo: { type: "image", defaultWidth: 12, defaultHeight: 6 },
};

// ─── Color role → palette index ────────────────────────────────────────

function resolveColorRole(palette: string[], role: ColorRole | undefined): string | undefined {
  if (!role || palette.length === 0) return undefined;
  switch (role) {
    case "primary":
      return palette[0];
    case "secondary":
      return palette[1] ?? palette[0];
    case "accent":
      return palette[2] ?? palette[1] ?? palette[0];
    case "surface":
      return palette[1] ?? palette[0];
    case "onPrimary":
      // Contrasting text color on the primary. If primary is dark-ish,
      // use the lightest in the palette; otherwise use the darkest.
      return pickContrastingText(palette, palette[0]);
    case "onSurface":
      return pickContrastingText(palette, palette[1] ?? palette[0]);
    case "background":
      return palette[palette.length - 1];
  }
}

function pickContrastingText(palette: string[], bg: string): string {
  const lum = relativeLuminance(bg);
  // bg is light → use darkest in palette; bg is dark → use lightest
  if (lum > 0.5) {
    let darkest = palette[0];
    for (const c of palette) if (relativeLuminance(c) < relativeLuminance(darkest)) darkest = c;
    return darkest;
  }
  let lightest = palette[0];
  for (const c of palette) if (relativeLuminance(c) > relativeLuminance(lightest)) lightest = c;
  return lightest;
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// ─── Main implementation ──────────────────────────────────────────────

const VALID_TYPES = new Set(["text", "image", "video", "shape", "custom", "audio"]);

export const planSceneLayoutDef = {
  type: "function",
  function: {
    name: "plan_scene_layout",
    description:
      "Work out and VALIDATE precise element positions/timing for a scene BEFORE building it. " +
      "This is the design blueprint. Pass element roles in declaration order - later elements can be " +
      "positioned relative to earlier ones (relativeTo + relation: below|above|leftOf|rightOf|sameSpot|" +
      "centerXOn|centerYOn|alignedLeft|alignedRight|alignedTop|alignedBottom). " +
      "Use presetRole (headline|subtitle|kicker|body|caption|statNumber|ctaButton|backgroundPanel|" +
      "imageHero|icon|divider|logo) to get professional size defaults instead of inventing them. " +
      "Use align (left|centerX|right|top|centerY|bottom) with alignTo:'canvas' or a role to snap to an edge. " +
      "Pass designTokens (palette, typePair, margin, typeScale, motionVocabulary) once - typically " +
      "copied from the current storyboard's brief.designLanguage - and every element snaps to the same " +
      "grid, palette, and type scale. Pass animationPlan (stagger|wave|burst|sequential) to auto-generate " +
      "consistent entrance timings for all elements. Returns the resolved layout, the design-token " +
      "application report, the layout flags, AND a polish-flag preview (would this scene be flagged as " +
      "text-only/static/etc by review_scene?). Use the returned x/y/width/height/startFrame exactly when " +
      "calling build_scene next. For any scene with more than one or two elements, or any text near/on a " +
      "shape or image, do this before building.",
    parameters: {
      type: "object",
      properties: {
        elements: {
          type: "array",
          description: "In the order you want them resolved. An element can only be positioned relative to one that appears EARLIER in this array.",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              type: { type: "string", enum: ["text", "image", "video", "shape", "custom", "audio"] },
              presetRole: {
                type: "string",
                enum: ["headline", "subtitle", "kicker", "body", "caption", "statNumber", "statLabel", "ctaButton", "backgroundPanel", "backgroundImage", "imageHero", "imageSecondary", "icon", "divider", "logo"],
                description: "Curated professional defaults for this role's size and text style. Use this instead of guessing width/height/textStyle.",
              },
              width: { type: "number" },
              height: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              relativeTo: { type: "string" },
              relation: {
                type: "string",
                enum: ["below", "above", "leftOf", "rightOf", "sameSpot", "centerXOn", "centerYOn", "alignedLeft", "alignedRight", "alignedTop", "alignedBottom"],
              },
              gap: { type: "number" },
              zIndex: { type: "number" },
              startFrame: { type: "number" },
              durationInFrames: { type: "number" },
              align: { type: "string", enum: ["left", "centerX", "right", "top", "centerY", "bottom"] },
              alignTo: { type: "string", description: "'canvas' or the role of an earlier element." },
              textStyle: {
                type: "object",
                properties: {
                  fontSize: { type: "number" },
                  fontWeight: { type: "number" },
                  fontFamily: { type: "string" },
                  textAlign: { type: "string", enum: ["left", "center", "right"] },
                  letterSpacing: { type: "number" },
                },
              },
              colorRole: { type: "string", enum: ["primary", "secondary", "accent", "surface", "onPrimary", "onSurface", "background"] },
              fillColorRole: { type: "string", enum: ["primary", "secondary", "accent", "surface", "onPrimary", "onSurface", "background"] },
            },
            required: ["role", "type"],
          },
        },
        designTokens: {
          type: "object",
          description: "Read from the current storyboard's brief.designLanguage. Snaps the layout to a consistent margin, palette, and type scale.",
          properties: {
            palette: { type: "array", items: { type: "string" } },
            typePair: {
              type: "object",
              properties: { display: { type: "string" }, body: { type: "string" } },
            },
            margin: { type: "number", description: "Percent of canvas (0-20). Default 8." },
            typeScale: {
              type: "object",
              properties: { display: { type: "number" }, body: { type: "number" }, kicker: { type: "number" } },
            },
            motionVocabulary: { type: "array", items: { type: "string" } },
          },
        },
        animationPlan: { type: "string", enum: ["stagger", "wave", "burst", "sequential"] },
        animationStagger: { type: "number", description: "Frames between element entrances. Default 8." },
        animationDuration: { type: "number", description: "Per-element entrance duration. Default 18." },
        animationEasing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut", "circOut", "backOut"] },
        backgroundColor: { type: "string" },
        transitionIn: {
          type: "object",
          properties: {
            type: { type: "string" },
            durationInFrames: { type: "number" },
          },
        },
        previousTransitionIn: {
          type: "object",
          properties: {
            type: { type: "string" },
            durationInFrames: { type: "number" },
          },
        },
        hasNextScene: { type: "boolean" },
      },
      required: ["elements"],
    },
  },
};

/**
 * Reads the current storyboard's brief.designLanguage if available, so
 * the agent doesn't have to re-pass designTokens on every call after
 * the storyboard is set.
 */
function readDesignTokensFromStoryboard(): DesignLanguage | undefined {
  const comp = sceneStore.get();
  return comp.storyboard?.brief?.designLanguage as DesignLanguage | undefined;
}

export const planSceneLayoutImpl = async (rawArgs: any) => {
  const args = rawArgs as PlanSceneLayoutArgs;

  // Fall back to the storyboard's design language if not passed.
  const tokens = args.designTokens ?? readDesignTokensFromStoryboard();
  const margin = clamp(tokens?.margin ?? 8, 0, 20);
  const stagger = args.animationStagger ?? 8;
  const animDuration = args.animationDuration ?? 18;
  const animEasing = args.animationEasing ?? "easeOut";

  const resolvedByRole = new Map<string, { x: number; y: number; width: number; height: number }>();
  const resolved: ResolvedElement[] = [];
  // Track which roles the agent declared, so we can error on
  // relativeTo references that don't exist.
  const declaredRoles: string[] = [];
  // Hoisted so designTokenUsage at the end can report the actual palette.
  const palette = tokens?.palette ?? [];

  args.elements.forEach((spec, index) => {
    if (!VALID_TYPES.has(spec.type)) {
      throw new Error(
        `Element "${spec.role}" has an invalid type "${spec.type}" - must be exactly one of text, image, video, shape, custom, audio.`,
      );
    }
    if (declaredRoles.includes(spec.role)) {
      throw new Error(`Element role "${spec.role}" is duplicated in this call. Roles must be unique.`);
    }
    declaredRoles.push(spec.role);

    // Apply presetRole defaults to missing fields.
    const preset = spec.presetRole ? PRESET_DEFAULTS[spec.presetRole] : undefined;
    const effectiveType = spec.type ?? preset?.type ?? "shape";
    const effectiveWidth = spec.width ?? preset?.defaultWidth ?? 50;
    const effectiveHeight = spec.height ?? preset?.defaultHeight ?? 10;

    let x = spec.x;
    let y = spec.y;

    // 1. relativeTo / relation - compute x/y from a reference element.
    if (spec.relativeTo) {
      const ref = resolvedByRole.get(spec.relativeTo);
      if (!ref) {
        throw new Error(
          `relativeTo "${spec.relativeTo}" (for element "${spec.role}") must be the role of an EARLIER element in this same call. ` +
            `Roles resolved so far: ${[...resolvedByRole.keys()].join(", ") || "(none)"}.`,
        );
      }
      const gap = spec.gap ?? 2;
      switch (spec.relation ?? "below") {
        case "below":
          x = ref.x;
          y = ref.y + ref.height + gap;
          break;
        case "above":
          x = ref.x;
          y = ref.y - effectiveHeight - gap;
          break;
        case "leftOf":
          x = ref.x - effectiveWidth - gap;
          y = ref.y;
          break;
        case "rightOf":
          x = ref.x + ref.width + gap;
          y = ref.y;
          break;
        case "sameSpot":
          x = ref.x;
          y = ref.y;
          break;
        case "centerXOn":
          // Horizontally centered on the reference, same y as reference.
          x = ref.x + ref.width / 2 - effectiveWidth / 2;
          y = ref.y;
          break;
        case "centerYOn":
          // Vertically centered on the reference, same x as reference.
          x = ref.x;
          y = ref.y + ref.height / 2 - effectiveHeight / 2;
          break;
        case "alignedLeft":
          // Same left edge as reference, y as given (or below if no y).
          x = ref.x;
          if (y === undefined) y = ref.y + ref.height + (spec.gap ?? 2);
          break;
        case "alignedRight":
          x = ref.x + ref.width - effectiveWidth;
          if (y === undefined) y = ref.y + ref.height + (spec.gap ?? 2);
          break;
        case "alignedTop":
          if (x === undefined) x = ref.x;
          y = ref.y;
          break;
        case "alignedBottom":
          if (x === undefined) x = ref.x;
          y = ref.y + ref.height - effectiveHeight;
          break;
      }
    }

    // 2. align / alignTo - snap an edge to the canvas or a reference.
    if (spec.align && spec.alignTo !== undefined) {
      const isCanvas = spec.alignTo === "canvas";
      const ref = isCanvas ? { x: margin, y: margin, width: 100 - margin * 2, height: 100 - margin * 2 } : resolvedByRole.get(spec.alignTo);
      if (!ref && !isCanvas) {
        throw new Error(`alignTo "${spec.alignTo}" (for element "${spec.role}") must be 'canvas' or the role of an earlier element.`);
      }
      const r = ref as { x: number; y: number; width: number; height: number };
      switch (spec.align) {
        case "left":
          x = r.x;
          break;
        case "centerX":
          x = r.x + r.width / 2 - effectiveWidth / 2;
          break;
        case "right":
          x = r.x + r.width - effectiveWidth;
          break;
        case "top":
          y = r.y;
          break;
        case "centerY":
          y = r.y + r.height / 2 - effectiveHeight / 2;
          break;
        case "bottom":
          y = r.y + r.height - effectiveHeight;
          break;
      }
    }

    if (x === undefined || y === undefined) {
      throw new Error(
        `Element "${spec.role}" needs either x/y, relativeTo+relation, or align+alignTo. ` +
          `None of these were supplied or the relative element was not found.`,
      );
    }

    // 3. Clamp to the margin grid when designTokens margin is set. The
    // design playbook calls for a consistent edge margin - this enforces
    // it instead of trusting the agent to remember.
    if (tokens) {
      const minX = margin;
      const maxX = 100 - margin - effectiveWidth;
      const minY = margin;
      const maxY = 100 - margin - effectiveHeight;
      if (x < minX) x = minX;
      if (y < minY) y = minY;
      if (x > maxX) x = Math.max(minX, maxX);
      if (y > maxY) y = Math.max(minY, maxY);
    }

    // 4. Off-canvas rejection for content elements (text/image/video/custom).
    // Shapes are exempt: a blurred glow bleeding off the edge is normal.
    if (spec.type !== "shape" && spec.type !== "audio") {
      const overRight = x + effectiveWidth - 100;
      const overBottom = y + effectiveHeight - 100;
      if (x < -5 || y < -5 || overRight > 5 || overBottom > 5) {
        throw new Error(
          `Element "${spec.role}" (${spec.type}) resolves to x:${round1(x)}, y:${round1(y)}, width:${effectiveWidth}, height:${effectiveHeight} - ` +
            `that puts it mostly or entirely off-canvas. Content elements must stay within the 0-100 range ` +
            `(x + width <= 100, y + height <= 100). Adjust the position/size, use relativeTo+relation, ` +
            `or pass designTokens.margin to snap to the project grid.`,
        );
      }
    }

    // 5. textStyle fill from presetRole and typeScale.
    let textStyle: PlanElementSpec["textStyle"] | undefined;
    if (effectiveType === "text") {
      const tsSpec = spec.textStyle ?? {};
      const tsTokens = tokens?.typeScale;
      let fontSize = tsSpec.fontSize;
      let fontFamily = tsSpec.fontFamily;
      if (fontSize === undefined) {
        if (spec.presetRole === "headline" || spec.presetRole === "statNumber") fontSize = tsTokens?.display;
        else if (spec.presetRole === "kicker" || spec.presetRole === "statLabel" || spec.presetRole === "caption") fontSize = tsTokens?.kicker;
        else fontSize = tsTokens?.body;
      }
      if (typeof fontFamily === "string" && (fontFamily === "display" || fontFamily === "body")) {
        fontFamily = tokens?.typePair?.[fontFamily];
      }
      textStyle = {
        fontSize,
        fontWeight: tsSpec.fontWeight ?? preset?.textStyle?.fontWeight,
        fontFamily,
        textAlign: tsSpec.textAlign ?? preset?.textStyle?.textAlign,
        letterSpacing: tsSpec.letterSpacing ?? preset?.textStyle?.letterSpacing,
      };
    }

    // 6. Color role resolution.
    const color = resolveColorRole(palette, spec.colorRole);
    const fillColor = resolveColorRole(palette, spec.fillColorRole);

    // 7. Animation plan: compute entrance per element.
    let entranceAnimation: {
      property: "opacity" | "x" | "y" | "scale";
      from: number;
      to: number;
      startFrame: number;
      durationInFrames: number;
      easing: string;
    } | undefined;
    if (args.animationPlan) {
      const offset = computeAnimationOffset(args.animationPlan, index, args.elements.length, stagger);
      entranceAnimation = {
        property: "opacity",
        from: 0,
        to: 1,
        startFrame: offset,
        durationInFrames: animDuration,
        easing: animEasing,
      };
    }

    // 8. startFrame: explicit > animation plan > 0.
    let startFrame: number;
    if (entranceAnimation) {
      startFrame = entranceAnimation.startFrame;
    } else if (typeof spec.startFrame === "number") {
      startFrame = spec.startFrame;
    } else {
      startFrame = 0;
    }

    resolvedByRole.set(spec.role, { x, y, width: effectiveWidth, height: effectiveHeight });
    // animations: the auto-generated entrance (when animationPlan is set)
    // goes into the standard animations array, matching the format
    // build_scene already understands. The agent can copy this array
    // directly into its build_scene call.
    const animations: Array<Record<string, unknown>> = [];
    if (entranceAnimation) {
      animations.push({
        property: entranceAnimation.property,
        from: entranceAnimation.from,
        to: entranceAnimation.to,
        startFrame: entranceAnimation.startFrame,
        durationInFrames: entranceAnimation.durationInFrames,
        easing: entranceAnimation.easing,
      });
    }
    resolved.push({
      role: spec.role,
      type: effectiveType,
      presetRole: spec.presetRole,
      x: round1(x),
      y: round1(y),
      width: effectiveWidth,
      height: effectiveHeight,
      zIndex: spec.zIndex ?? index,
      startFrame,
      durationInFrames: spec.durationInFrames,
      textStyle,
      color,
      fillColor,
      animations,
    });
  });

  // Build LayoutBox for the spatial-only check.
  const boxes: LayoutBox[] = resolved
    .filter((el) => el.type !== "audio")
    .map((el) => ({
      id: el.role,
      name: el.role,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      zIndex: el.zIndex,
      startFrame: el.startFrame,
      opacity: 1,
    }));

  const flags = computeLayoutFlags(boxes);

  // Polish preview: would review_scene flag this scene once it's built?
  const polishElements = resolved.map((el) => ({
    type: el.type,
    animations: el.animations,
  }));
  const polish: PolishFlags = analyzePolish({
    elements: polishElements,
    backgroundColor: args.backgroundColor,
    transitionIn: args.transitionIn ?? null,
    previousTransitionIn: args.previousTransitionIn,
    hasNextScene: args.hasNextScene,
  });
  const polishStrings = polishFlagStrings(polish);
  if (polishStrings.length > 0) flags.push(...polishStrings);

  // Design token usage report - tells the agent (and the user) what
  // was applied so the design language is verifiable.
  const designTokenUsage = tokens
    ? {
        marginApplied: margin,
        paletteSize: palette.length,
        typeScaleApplied: tokens.typeScale,
        typePairApplied: tokens.typePair,
        motionVocabularyApplied: tokens.motionVocabulary ?? [],
      }
    : { marginApplied: 0, paletteSize: 0 };

  return {
    resolvedElements: resolved,
    flags,
    polish,
    polishWarnings: polishStrings,
    designTokenUsage,
  };
};

function computeAnimationOffset(plan: AnimationPlan, index: number, total: number, stagger: number): number {
  switch (plan) {
    case "stagger":
      return index * stagger;
    case "sequential":
      // Sequential is slower - each element fully completes before the
      // next starts. stagger = stagger + animationDuration on the caller.
      return index * (stagger * 2);
    case "wave":
      // Wave: items near the center start first, edges last.
      // For an even count, this still gives a flowing radial feel.
      const center = (total - 1) / 2;
      return Math.round(Math.abs(index - center) * stagger);
    case "burst":
      // All at once, but each is slightly different by 1-2 frames so
      // it doesn't read as a single frame flash.
      return Math.max(0, index - 1);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Re-export so the old `plan_scene_layout` call site in tools.ts can
// still import it from one place.
export { planSceneLayoutDef as default };
