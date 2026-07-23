import { Composition } from "../../schema/scene";
import { AVAILABLE_FONTS } from "../../fontCatalog";

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
  priority: number; // Lower numbers rendered first
  condition?: (ctx: PromptContext) => boolean;
  render: (ctx: PromptContext) => string;
}

export class PromptEngine {
  private sections: Map<string, PromptSection> = new Map();

  constructor() {
    this.registerDefaultSections();
  }

  register(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  build(context: PromptContext): string {
    const activeSections = [...this.sections.values()]
      .filter((s) => (s.condition ? s.condition(context) : true))
      .sort((a, b) => a.priority - b.priority);

    return activeSections
      .map((s) => s.render(context))
      .filter(Boolean)
      .join("\n\n");
  }

  private registerDefaultSections() {
    // 1. Identity & Core Rules
    this.register({
      id: "identity",
      priority: 10,
      render: () => `You are a professional video-editing agent for Dev Hive-motion v2.0.
You build real, polished videos — motion graphics, promos, explainers — by manipulating a JSON scene graph through tools.
You never generate raw code TSX.`,
    });

    // 2. Coordinates & Positioning
    this.register({
      id: "coordinates",
      priority: 20,
      render: () => `COORDINATES ARE PERCENT (0-100), NOT PIXELS:
- x, y, width, height on every element are 0-100 (% of canvas).
- Full screen background: x:0, y:0, width:100, height:100.
- Center a box of width W: x = (100 - W) / 2.
- Layering (zIndex): higher zIndex draws on top.
- Animations (x/y): from/to are % offset from resting position.`,
    });

    // 3. Font List
    this.register({
      id: "fonts",
      priority: 30,
      render: () => {
        const fontList = Object.entries(AVAILABLE_FONTS)
          .map(([name, desc]) => `  - "${name}": ${desc}`)
          .join("\n");
        return `FONTS — only use fontFamily values from this list:
${fontList}`;
      },
    });

    // 4. Mentions Context
    this.register({
      id: "mentions",
      priority: 35,
      condition: (ctx) => Boolean(ctx.mentions && ctx.mentions.length > 0),
      render: (ctx) => {
        const list = ctx.mentions
          ?.map((m) => `- @${m.name} (${m.type}, ID: ${m.id})`)
          .join("\n");
        return `USER REFERENCED SPECIFIC ELEMENTS/SCENES IN THIS PROMPT (@mentions):
${list}
When performing actions on these elements/scenes, target these explicit IDs directly.`;
      },
    });

    // 5. Image Context
    this.register({
      id: "images",
      priority: 38,
      condition: (ctx) => Boolean(ctx.imageUrls && ctx.imageUrls.length > 0),
      render: (ctx) => `THE USER ATTACHED ${ctx.imageUrls?.length} REFERENCE IMAGE(S).
Use these images as visual inspiration for colors, typography style, layout structure, and aesthetic choices.`,
    });

    // 6. Workflow Phase (Research, Plan, Layout, Build, Review)
    this.register({
      id: "workflow",
      priority: 40,
      render: (ctx) => `WORKFLOW STEPS:
1. RESEARCH: Use web_search or wikipedia_lookup for factual topics.
2. PLAN: Use create_storyboard for multi-scene structure.
3. LAYOUT: Use plan_scene_layout before building multi-element scenes.
4. BUILD: Use build_scene or add_*_element tools.
5. REVIEW: Use review_scene to check for overlaps/bounds issues.
6. NEW ADVANCED TOOLS:
   - set_orientation: Change video preset (landscape/portrait/square)
   - reorder_scenes: Reorder scene timeline
   - animate_scene: Batch-apply entrance animations to a scene
   - set_all_transitions: Set transitions across all scenes
   - edit_by_mention: Target @mentioned elements directly

Current project orientation: ${ctx.composition.orientation} (${ctx.composition.width}x${ctx.composition.height}).
Total scenes: ${ctx.composition.scenes.length}.`,
    });
  }
}

export const promptEngine = new PromptEngine();
