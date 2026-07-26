/**
 * Template tools - save, list, apply, and delete named scene templates.
 *
 * Templates are stored separately from the composition (in
 * data/templates.json) so the user can build a personal library of
 * patterns they like, and the agent can re-apply them to future
 * projects.
 *
 * Five tools in one file because they share the same persistence
 * surface and the agent will use them together:
 *
 *   - apply_template({ templateName, sceneId?, designLanguage? }):
 *     Build a NEW scene from a template (or overwrite an existing
 *     sceneId's contents). Optionally re-style using the project's
 *     current designLanguage so the same template can serve a
 *     corporate explainer and a kids' video.
 *
 *   - save_scene_as_template({ sceneId, templateName, description?,
 *     genre?, overwrite? }): Capture a successful scene as a
 *     reusable template.
 *
 *   - list_templates({ genre? }): List available templates, optionally
 *     filtered by genre.
 *
 *   - delete_template({ templateName }): Remove a template.
 *
 *   - suggest_templates({ genre?, limit? }): Recommend templates for
 *     the current storyboard. Scores each template against the
 *     current project's genre and design language so the agent can
 *     pick a relevant starting point instead of building from zero.
 *
 * Why this exists: the user explicitly asked for "the smallest
 * details" editing and for the agent to be able to re-use patterns.
 * Without templates, the agent re-types the same hero-reveal scene
 * each time and the result drifts. With templates, the agent
 * captures its best work and reuses it.
 */

import { nanoid } from "nanoid";
import { sceneStore } from "../../../server/sceneStore";
import type { Composition, Scene, SceneElement } from "../../../schema/scene";
import { listTemplates, getTemplate, saveTemplate, deleteTemplate, templateFromScene, type Template } from "../../templates";

// ============================================================
// apply_template
// ============================================================

interface ApplyTemplateArgs {
  templateName: string;
  /** If set, OVERWRITES the scene at sceneId with the template contents. If not, creates a new scene. */
  sceneId?: string;
  /** Override the template's default duration. */
  durationInFrames?: number;
  /** Override the template's default background color. */
  backgroundColor?: string;
  /** Override the template's default transition. */
  transitionIn?: { type: string; direction?: string; durationInFrames?: number } | null;
  /**
   * If the project has a DesignLanguage set on the storyboard, pass
   * it here so the template is re-styled to match. The tool remaps
   * template colors through the palette and applies typeScale.
   */
  designLanguage?: {
    palette?: string[];
    typeScale?: { display: number; body: number; kicker: number };
    typePair?: { display: string; body: string };
  };
}

export const applyTemplateDef = {
  type: "function",
  function: {
    name: "apply_template",
    description:
      "Build a new scene from a named template, or overwrite an existing scene's contents with one. " +
      "Templates are reusable scene patterns the agent has saved previously (or that come with the project). " +
      "Use this to apply the same hero-reveal, stat-callout, or quote-slide pattern across multiple scenes without rebuilding from scratch. " +
      "Pass designLanguage to re-style the template with the current project's palette and type scale - same template, different brand. " +
      "Call list_templates first to see what's available, or suggest_templates to get a recommended starting point for the current storyboard.",
    parameters: {
      type: "object",
      properties: {
        templateName: { type: "string" },
        sceneId: { type: "string", description: "Optional. If set, OVERWRITES the scene at this id with the template's contents. The scene's elements are replaced wholesale." },
        durationInFrames: { type: "number" },
        backgroundColor: { type: "string" },
        transitionIn: { type: "object" },
        designLanguage: { type: "object" },
      },
      required: ["templateName"],
    },
  },
};

export const applyTemplateImpl = async (rawArgs: any) => {
  const args = rawArgs as ApplyTemplateArgs;
  if (!args.templateName) throw new Error("apply_template: templateName is required.");
  const template = await getTemplate(args.templateName);
  if (!template) {
    const all: Template[] = await listTemplates();
    throw new Error(
      `apply_template: template "${args.templateName}" not found. Available: ${all.map((t: Template) => t.name).join(", ") || "(none)"}. ` +
        `Call list_templates to see all, or save_scene_as_template to create one.`,
    );
  }

  // Re-style: swap placeholder colors with project palette colors.
  // Convention used by the agent: placeholders are {primary}, {accent},
  // {onSurface}, {background} (curly-brace tokens), and they get mapped
  // to palette[0], palette[2], "white" / "onPrimary", palette[0] (or
  // dark variant) respectively.
  const palette = args.designLanguage?.palette ?? template.elements[0]?.type === "shape" ? [] : [];
  const typeScale = args.designLanguage?.typeScale;
  const typePair = args.designLanguage?.typePair;

  function restyleColor(input: string | undefined): string | undefined {
    if (!input) return input;
    if (!palette.length) return input;
    if (input === "{primary}") return palette[0];
    if (input === "{secondary}") return palette[1] ?? palette[0];
    if (input === "{accent}") return palette[2] ?? palette[1] ?? palette[0];
    if (input === "{surface}") return palette[1] ?? palette[0];
    if (input === "{onPrimary}" || input === "{onSurface}") return "#ffffff";
    if (input === "{background}") return palette[0];
    return input;
  }

  function restyleElement(el: any): SceneElement {
    const copy = { ...el };
    if (copy.fill) copy.fill = restyleColor(copy.fill);
    if (copy.color) copy.color = restyleColor(copy.color);
    if (copy.strokeColor) copy.strokeColor = restyleColor(copy.strokeColor);
    if (copy.highlightColor) copy.highlightColor = restyleColor(copy.highlightColor);
    if (copy.gradient?.from) copy.gradient = { ...copy.gradient, from: restyleColor(copy.gradient.from) ?? copy.gradient.from };
    if (copy.gradient?.to) copy.gradient = { ...copy.gradient, to: restyleColor(copy.gradient.to) ?? copy.gradient.to };
    if (typeScale && copy.type === "text") {
      // Map template font sizes to the project type scale by role.
      if (copy.presetRole === "headline" || copy.presetRole === "statNumber") {
        copy.fontSize = typeScale.display;
      } else if (copy.presetRole === "kicker" || copy.presetRole === "statLabel" || copy.presetRole === "caption") {
        copy.fontSize = typeScale.kicker;
      } else {
        copy.fontSize = typeScale.body;
      }
    }
    if (typePair && copy.type === "text") {
      if (copy.presetRole === "headline" || copy.presetRole === "statNumber") {
        copy.fontFamily = typePair.display;
      } else {
        copy.fontFamily = typePair.body;
      }
    }
    // Always mint a fresh id so the new scene has unique elements.
    copy.id = `el-${nanoid(6)}`;
    return copy as SceneElement;
  }

  const newElements: SceneElement[] = template.elements.map(restyleElement);
  const targetDuration = args.durationInFrames ?? template.durationInFrames;
  const targetBg = args.backgroundColor ?? template.backgroundColor;
  const targetTransition = args.transitionIn !== undefined ? args.transitionIn : template.transitionIn;

  if (args.sceneId) {
    // Overwrite existing scene.
    await sceneStore.update((draft) => {
      const scene = draft.scenes.find((s) => s.id === args.sceneId);
      if (!scene) throw new Error(`apply_template: scene "${args.sceneId}" not found.`);
      scene.durationInFrames = targetDuration;
      scene.backgroundColor = targetBg;
      if (targetTransition === null) {
        scene.transitionIn = undefined;
      } else if (targetTransition) {
        scene.transitionIn = {
          type: targetTransition.type as Scene["transitionIn"] extends infer T ? T extends { type: infer U } ? U : never : never,
          direction: (targetTransition.direction as any) ?? "from-right",
          durationInFrames: targetTransition.durationInFrames ?? 15,
        };
      }
      scene.elements = newElements;
      return draft;
    });
    return {
      sceneId: args.sceneId,
      action: "overwrote",
      templateName: args.templateName,
      elementCount: newElements.length,
    };
  }

  // Create a new scene.
  let newSceneId = "";
  await sceneStore.update((draft) => {
    const newScene: Scene = {
      id: `sc-${nanoid(6)}`,
      name: `Scene from "${args.templateName}"`,
      durationInFrames: targetDuration,
      backgroundColor: targetBg,
      elements: newElements,
      transitionIn: targetTransition
        ? {
            type: targetTransition.type as any,
            direction: (targetTransition.direction as any) ?? "from-right",
            durationInFrames: targetTransition.durationInFrames ?? 15,
          }
        : undefined,
      locked: false,
      solo: false,
      collapsed: false,
    };
    draft.scenes.push(newScene);
    newSceneId = newScene.id;
    return draft;
  });
  return {
    sceneId: newSceneId,
    action: "created",
    templateName: args.templateName,
    elementCount: newElements.length,
  };
};

// ============================================================
// save_scene_as_template
// ============================================================

interface SaveSceneAsTemplateArgs {
  sceneId: string;
  templateName: string;
  description?: string;
  genre?: string;
  /** If false and a template with the same name exists, the call errors. Default true. */
  overwrite?: boolean;
}

export const saveSceneAsTemplateDef = {
  type: "function",
  function: {
    name: "save_scene_as_template",
    description:
      "Capture an existing scene as a reusable template. Use this when a scene is working well and you want to use the same pattern again in another scene or project. " +
      "Give it a short, descriptive name (e.g. 'hero-reveal-dark', 'stat-callout-minimal', 'quote-slide-italic') so it can be found later via list_templates. " +
      "After saving, the template can be applied via apply_template. Colors are stored as-is; to re-color at apply time, use {primary}/{accent}/{onSurface} placeholders when you build the scene originally, or use designLanguage override at apply time.",
    parameters: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        templateName: { type: "string" },
        description: { type: "string" },
        genre: { type: "string", description: "Optional genre tag (corporate, social-reel, cinematic, etc.) for filtering via list_templates." },
        overwrite: { type: "boolean", description: "Default true. Set false to error if a template with the same name already exists." },
      },
      required: ["sceneId", "templateName"],
    },
  },
};

export const saveSceneAsTemplateImpl = async (rawArgs: any) => {
  const args = rawArgs as SaveSceneAsTemplateArgs;
  if (!args.sceneId) throw new Error("save_scene_as_template: sceneId is required.");
  if (!args.templateName) throw new Error("save_scene_as_template: templateName is required.");

  const existing = await getTemplate(args.templateName);
  if (existing && args.overwrite === false) {
    throw new Error(
      `save_scene_as_template: template "${args.templateName}" already exists. ` +
        `Pass overwrite: true to replace it, or pick a different name.`,
    );
  }

  const composition = sceneStore.get();
  const scene = composition.scenes.find((s) => s.id === args.sceneId);
  if (!scene) throw new Error(`save_scene_as_template: scene "${args.sceneId}" not found.`);

  const template = templateFromScene(scene, {
    templateName: args.templateName,
    description: args.description,
    genre: args.genre,
  });
  await saveTemplate(template);

  return {
    ok: true,
    templateName: args.templateName,
    sceneId: args.sceneId,
    elementCount: scene.elements.length,
    replaced: Boolean(existing),
  };
};

// ============================================================
// list_templates
// ============================================================

interface ListTemplatesArgs {
  /** Filter by genre. If omitted, returns all templates. */
  genre?: string;
  /** Substring match on template name (case-insensitive). */
  search?: string;
}

export const listTemplatesDef = {
  type: "function",
  function: {
    name: "list_templates",
    description:
      "List all saved templates, optionally filtered by genre or by name. Use this to discover what reusable patterns the agent has built so far. " +
      "If the result is empty, call suggest_templates (which can recommend built-in starting points) or save_scene_as_template to capture a successful scene as a template first.",
    parameters: {
      type: "object",
      properties: {
        genre: { type: "string" },
        search: { type: "string", description: "Substring match on template name, case-insensitive." },
      },
    },
  },
};

export const listTemplatesImpl = async (rawArgs: any) => {
  const args = (rawArgs ?? {}) as ListTemplatesArgs;
  let templates: Template[] = await listTemplates();
  if (args.genre) {
    templates = templates.filter((t: Template) => t.genre === args.genre);
  }
  if (args.search) {
    const needle = args.search.toLowerCase();
    templates = templates.filter(
      (t: Template) => t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle),
    );
  }
  return {
    count: templates.length,
    templates: templates.map((t: Template) => ({
      name: t.name,
      description: t.description,
      genre: t.genre,
      elementCount: t.elements.length,
      createdAt: t.createdAt,
    })),
  };
};

// ============================================================
// delete_template
// ============================================================

interface DeleteTemplateArgs {
  templateName: string;
}

export const deleteTemplateDef = {
  type: "function",
  function: {
    name: "delete_template",
    description: "Remove a saved template by name. Idempotent - returns success even if the template does not exist.",
    parameters: {
      type: "object",
      properties: {
        templateName: { type: "string" },
      },
      required: ["templateName"],
    },
  },
};

export const deleteTemplateImpl = async (rawArgs: any) => {
  const args = rawArgs as DeleteTemplateArgs;
  if (!args.templateName) throw new Error("delete_template: templateName is required.");
  const removed = await deleteTemplate(args.templateName);
  return { ok: true, templateName: args.templateName, removed };
};

// ============================================================
// suggest_templates
// ============================================================

interface SuggestTemplatesArgs {
  /** The genre of the current project (from storyboard brief). Boosts matching templates. */
  genre?: string;
  /** The current storyboard scene names/concepts. Boosts templates with similar key elements. */
  sceneSummaries?: string[];
  /** Max suggestions to return. Default 5. */
  limit?: number;
}

export const suggestTemplatesDef = {
  type: "function",
  function: {
    name: "suggest_templates",
    description:
      "Recommend templates for the current project. Ranks all saved templates by relevance to the project's genre and scene content, and returns the top N. " +
      "Use this at the start of a build to find a good starting point - either a template that matches the genre exactly, or one whose structure is closest to the kind of scene the user is asking for.",
    parameters: {
      type: "object",
      properties: {
        genre: { type: "string" },
        sceneSummaries: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
    },
  },
};

export const suggestTemplatesImpl = async (rawArgs: any) => {
  const args = (rawArgs ?? {}) as SuggestTemplatesArgs;
  const limit = args.limit ?? 5;
  const templates: Template[] = await listTemplates();

  // Score each template.
  const scored = templates.map((t: Template) => {
    let score = 0;
    const reasons: string[] = [];
    if (args.genre && t.genre === args.genre) {
      score += 50;
      reasons.push(`genre match: ${args.genre}`);
    } else if (args.genre && t.genre) {
      score += 10; // partial: has a genre tag, just not this one
    }
    if (args.sceneSummaries) {
      for (const summary of args.sceneSummaries) {
        const words = summary.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        for (const w of words) {
          if (t.name.toLowerCase().includes(w) || t.description.toLowerCase().includes(w)) {
            score += 5;
            reasons.push(`keyword match: "${w}"`);
            break; // one match per scene is enough
          }
        }
      }
    }
    if (!t.genre) score -= 5; // un-genred templates are less likely to be the right fit
    return { template: t, score, reasons };
  });

  scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
  const top = scored.slice(0, limit);

  return {
    suggestions: top.map((s) => ({
      name: s.template.name,
      description: s.template.description,
      genre: s.template.genre,
      elementCount: s.template.elements.length,
      score: s.score,
      why: s.reasons.length > 0 ? s.reasons : ["available starting point"],
    })),
    considered: templates.length,
  };
};
