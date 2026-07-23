import { Composition } from "../../schema/scene";
import { logger } from "../../core/utils/logger";

export interface ReasoningPlan {
  userIntent: string;
  targetScenes: string[];
  plannedTools: string[];
  layoutStrategy?: string;
  notes: string[];
}

export class ChainOfThought {
  /**
   * Pre-analyzes a user request against the composition state to generate
   * an explicit reasoning outline before tool execution starts.
   */
  static analyze(prompt: string, composition: Composition): ReasoningPlan {
    const promptLower = prompt.toLowerCase();
    const targetScenes: string[] = [];
    const plannedTools: string[] = [];
    const notes: string[] = [];

    // Check for scene references
    composition.scenes.forEach((scene, index) => {
      if (
        promptLower.includes(scene.id) ||
        promptLower.includes(scene.name.toLowerCase()) ||
        promptLower.includes(`scene ${index + 1}`)
      ) {
        targetScenes.push(scene.id);
      }
    });

    // Check for orientation changes
    if (promptLower.includes("vertical") || promptLower.includes("portrait") || promptLower.includes("tiktok") || promptLower.includes("shorts")) {
      plannedTools.push("set_orientation");
      notes.push("Adjust orientation to portrait (1080x1920)");
    } else if (promptLower.includes("square") || promptLower.includes("instagram")) {
      plannedTools.push("set_orientation");
      notes.push("Adjust orientation to square (1080x1080)");
    }

    // Check for research needs
    if (promptLower.includes("video about") || promptLower.includes("promo for") || promptLower.includes("explainer")) {
      plannedTools.push("create_storyboard");
      notes.push("Create full storyboard before building scenes");
    }

    logger.info("ChainOfThought analysis complete", { plannedTools, targetScenesCount: targetScenes.length });

    return {
      userIntent: prompt,
      targetScenes,
      plannedTools,
      notes,
    };
  }
}
