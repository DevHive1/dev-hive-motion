import { SYSTEM_PROMPT } from "../systemPrompt";
import type { Composition } from "../../schema/scene";

export interface PromptContext {
  composition: Composition;
  userPrompt: string;
  conversationLength: number;
  availableTools: string[];
  mentions?: Array<{ type: string; id: string; name: string }>;
  imageUrls?: string[];
}

export interface PromptSection {
  id: string;
  priority: number; // Lower renders first
  condition?: (ctx: PromptContext) => boolean;
  render: (ctx: PromptContext) => string;
}

/**
 * Assembles the final system prompt from modular sections.
 *
 * Architecture: the full static SYSTEM_PROMPT (all rules, workflow steps,
 * creative direction, tool catalogue) is always the base at priority 10.
 * Dynamic sections — current project state, @mentions, image attachments —
 * are appended at higher priority numbers so the model always gets the
 * complete rule set PLUS real-time context about the session.
 *
 * Previously the PromptEngine re-implemented a shorter, duplicate version
 * of those rules, causing the model to work from an abbreviated rule set.
 * That's fixed: the single source of truth is systemPrompt.ts.
 */
export class PromptEngine {
  private sections: Map<string, PromptSection> = new Map();

  constructor() {
    this.registerDefaultSections();
  }

  register(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  build(context: PromptContext): string {
    const active = [...this.sections.values()]
      .filter((s) => (s.condition ? s.condition(context) : true))
      .sort((a, b) => a.priority - b.priority);

    return active
      .map((s) => s.render(context))
      .filter(Boolean)
      .join("\n\n");
  }

  private registerDefaultSections() {
    // ── 1. Full canonical system prompt (all rules live here) ─────────────
    this.register({
      id: "core",
      priority: 10,
      render: () => SYSTEM_PROMPT,
    });

    // ── 2. Live project state ─────────────────────────────────────────────
    this.register({
      id: "project-state",
      priority: 50,
      render: (ctx) => {
        const { composition } = ctx;
        const totalFrames = composition.scenes.reduce((s, sc) => s + sc.durationInFrames, 0);
        const durationSec = (totalFrames / composition.fps).toFixed(1);
        return [
          `CURRENT PROJECT STATE (live, as of this message):`,
          `- Name: ${composition.name}`,
          `- Orientation: ${composition.orientation} (${composition.width}×${composition.height})`,
          `- FPS: ${composition.fps}`,
          `- Scenes: ${composition.scenes.length}`,
          `- Total duration: ${durationSec}s`,
          composition.storyboard
            ? `- Storyboard: "${composition.storyboard.title}" (${composition.storyboard.scenes.length} planned scenes)`
            : `- Storyboard: none yet`,
        ].join("\n");
      },
    });

    // ── 3. @mention context ───────────────────────────────────────────────
    this.register({
      id: "mentions",
      priority: 55,
      condition: (ctx) => Boolean(ctx.mentions && ctx.mentions.length > 0),
      render: (ctx) => {
        const list = ctx.mentions!
          .map((m) => `  - @${m.name} (${m.type}, id: ${m.id})`)
          .join("\n");
        return (
          `USER REFERENCED SPECIFIC ELEMENTS/SCENES VIA @MENTION:\n` +
          `${list}\n` +
          `When acting on these, use the exact IDs above — do not call list_scenes to find them again.`
        );
      },
    });

    // ── 4. Attached reference images ──────────────────────────────────────
    this.register({
      id: "images",
      priority: 60,
      condition: (ctx) => Boolean(ctx.imageUrls && ctx.imageUrls.length > 0),
      render: (ctx) =>
        `THE USER ATTACHED ${ctx.imageUrls!.length} REFERENCE IMAGE(S) TO THIS MESSAGE.\n` +
        `Treat them as visual briefs: extract their color palette, typography weight, layout structure, ` +
        `and overall aesthetic, then apply those as the creative direction for whatever you build.`,
    });
  }
}

export const promptEngine = new PromptEngine();
