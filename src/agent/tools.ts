import { nanoid } from "nanoid";
import { sceneStore } from "../server/sceneStore";
import {
  SceneElementSchema,
  type Animation,
  type ImageElement,
  type Scene,
  type ShapeElement,
  type TextElement,
  type VideoElement,
  type CustomElement,
  type AudioElement,
  type Composition,
  type SceneElement,
  type Transition,
  type Storyboard,
} from "../schema/scene";
import { duckDuckGoSearch } from "./providers/duckduckgo";
import { searchStockPhotos, searchStockVideos } from "./providers/pexels";
import { checkUrl } from "./providers/urlCheck";
import { wikipediaLookup } from "./providers/wikipedia";
import { fetchPageContent } from "./providers/pageContent";
import { checkContrast } from "./providers/contrast";
import { generateImage } from "./providers/pollinations";
import { generateVoiceover } from "./providers/edgeTts";
import { searchFreeMusic } from "./providers/jamendo";
import { searchSoundEffects } from "./providers/freesound";
import { jinaReadUrl } from "./providers/jinaReader";
import { computeLayoutFlags, analyzePolish, polishFlagStrings, type LayoutBox } from "./layoutCheck";
import { setOrientationDef, setOrientationImpl } from "./tools/orientation";
import { reorderScenesDef, reorderScenesImpl } from "./tools/scene/reorder";
import { moveSceneDef, moveSceneImpl } from "./tools/scene/move";
import { setAllTransitionsDef, setAllTransitionsImpl } from "./tools/scene/transitions";
import { setSceneTransitionsDef, setSceneTransitionsImpl } from "./tools/scene/setTransitions";
import { animateSceneDef, animateSceneImpl } from "./tools/animation/batch";
import { removeAnimationDef, removeAnimationImpl } from "./tools/animation/removeAnimation";
import { addInOutAnimationImpl, addInOutAnimationDef, addEntranceAnimationImpl, addEntranceAnimationDef, addExitAnimationImpl, addExitAnimationDef } from "./tools/element/inOutAnimation";
import { editByMentionDef, editByMentionImpl } from "./tools/element/mention";
import { duplicateElementDef, duplicateElementImpl } from "./tools/element/duplicate";
import { nudgeElementDef, nudgeElementImpl } from "./tools/element/nudge";
import { timelineOverviewDef, timelineOverviewImpl } from "./tools/scene/timeline";
import { fitTextToBoxDef, fitTextToBoxImpl } from "./tools/element/fitText";
import { previewSingleSceneDef, previewSingleSceneImpl } from "./tools/scene/preview";
import { setAnimationTimingDef, setAnimationTimingImpl } from "./tools/animation/timing";
import { addLineDef, addLineImpl } from "./tools/element/line";
import { addBorderDef, addBorderImpl } from "./tools/element/border";
import { editDurationDef, editDurationImpl } from "./tools/scene/duration";
import { editTimingDef, editTimingImpl } from "./tools/scene/timing";
import {
  applyTemplateDef, applyTemplateImpl,
  saveSceneAsTemplateDef, saveSceneAsTemplateImpl,
  listTemplatesDef, listTemplatesImpl,
  deleteTemplateDef, deleteTemplateImpl,
  suggestTemplatesDef, suggestTemplatesImpl,
} from "./tools/scene/templates";
import { planSceneLayoutImpl, planSceneLayoutDef } from "./tools/scene/planLayout";
import { validateElementPatch, checkTransparentBlackScreen } from "./tools/element/validatePatch";
import { backgroundRemovalImpl, backgroundRemovalDef } from "./tools/image/removeBackground";
import { sequentialThinkingImpl, sequentialThinkingDef } from "./tools/reasoning/sequentialThinking";
import { diagnoseSceneImpl, diagnoseSceneDef } from "./tools/scene/diagnose";
import { auditSceneImpl, auditSceneDef } from "./tools/scene/audit";

/** Ollama/OpenAI-style tool definitions. Sent to the model on every turn. */
export const toolDefinitions = [
  setOrientationDef,
  reorderScenesDef,
  moveSceneDef,
  setAllTransitionsDef,
  animateSceneDef,
  editByMentionDef,
  {
    type: "function",
    function: {
      name: "list_scenes",
      description:
        "Get a summary of every scene and element currently in the project, including ids you need for other tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scene",
      description:
        "Get the COMPLETE state of a single scene: every element with all its fields (text, src, color, font, layout, zIndex), every animation, the incoming and outgoing transition, and the adjacent scene ids. " +
        "Use this when you need the full data of one specific scene, not the overview of all scenes and not just an analysis. " +
        "Complementary tools: list_scenes gives a one-line-per-element summary of every scene (cheap, but omits detail); review_scene gives a polish/flag analysis (good for catching issues, but skips raw data); " +
        "get_scene is the answer for \"what exactly is in scene X right now?\" " +
        "Pass includeAnimations: false only if you specifically need the response to be small.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string", description: "Id of the scene to fetch. Get it from list_scenes or from a previous add_scene / build_scene result." },
          includeAnimations: { type: "boolean", description: "Whether to include each element's animations array. Default true. Pass false only to keep the response tiny." },
        },
        required: ["sceneId"],
      },
    },
  },
  sequentialThinkingDef,
  {
    type: "function",
    function: {
      name: "add_scene",
      description: "Append a new scene to the end of the timeline.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          durationInFrames: { type: "number", description: "At 30fps, 150 = 5 seconds." },
          backgroundColor: { type: "string", description: "Hex color, e.g. #0b0b0f" },
        },
        required: ["name", "durationInFrames"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_text_element",
      description: "Add a text element to a scene.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          text: { type: "string" },
          x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
          y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
          width: { type: "number", description: "Percent of canvas width (0-100)." },
          height: { type: "number", description: "Percent of canvas height (0-100)." },
          fontSize: { type: "number" },
          fontFamily: {
            type: "string",
            description: "Must be one of the font names listed in the system prompt's FONTS section, e.g. 'Cairo' or 'Inter'. Anything else silently falls back to a generic default.",
          },
          fontWeight: { type: "number", description: "400 normal, 600 semibold, 700 bold, 800/900 for big display headlines." },
          color: { type: "string" },
          textAlign: { type: "string", enum: ["left", "center", "right"] },
          letterSpacing: { type: "number", description: "Pixels. 2-4 for small uppercase-style kicker labels." },
          textShadow: {
            oneOf: [
              { type: "boolean" },
              { type: "string" }
            ],
            description: "Shadow on text. Pass true for a default soft drop-shadow, false for none, or a raw CSS value like '0 4px 24px rgba(0,0,0,0.9)' for precise control. Always use on text over photos/video.",
          },
          highlightColor: { type: "string", description: "Background color chip behind the text - lower-third/caption-bar/badge look." },
          strokeColor: { type: "string", description: "Text outline color e.g. '#000000'. Pair with strokeWidth for bold outline style." },
          strokeWidth: { type: "number", description: "Text outline thickness in px. 1-3 subtle, 4-8 bold." },
          gradient: { type: "object", description: "Gradient text fill (overrides color). {angle:135, stops:[{color:'#f00',offset:0},{color:'#00f',offset:1}]}" },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
        },
        required: ["sceneId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_image_element",
      description: "Add an image element to a scene. The src MUST be a stable URL (e.g. /uploads/abc.jpg from a user-attached image, or a real URL from search_stock_images / generate_ai_image). Do NOT pass a base64 data: URL - data URLs render in the live preview but fail or bloat the composition JSON when the video is exported. If the user attached an image to this chat message, the system prompt will list the saved URL to use; copy it directly.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          src: { type: "string", description: "A stable URL or /uploads/ path. NOT a base64 data: URL - those break the exported video." },
          x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
          y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
          width: { type: "number", description: "Percent of canvas width (0-100). Use 100 for a full-bleed background image." },
          height: { type: "number", description: "Percent of canvas height (0-100). Use 100 for a full-bleed background image." },
          objectFit: { type: "string", enum: ["cover", "contain", "fill"] },
          borderRadius: { type: "number", description: "Pixels. Rounded corners read as more modern/deliberate." },
          boxShadow: {
            type: "string",
            description: "Raw CSS box-shadow for a framed/lifted card look, e.g. '0 20px 60px rgba(0,0,0,0.45)'.",
          },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
        },
        required: ["sceneId", "src"],
      },
    },
  },
  backgroundRemovalDef,
  {
    type: "function",
    function: {
      name: "add_video_element",
      description: "Add a video element to a scene.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          src: { type: "string" },
          x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
          y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
          width: { type: "number", description: "Percent of canvas width (0-100). Use 100 for a full-bleed background video." },
          height: { type: "number", description: "Percent of canvas height (0-100). Use 100 for a full-bleed background video." },
          muted: { type: "boolean" },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
        },
        required: ["sceneId", "src"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_shape_element",
      description:
        "Add a rectangle or circle shape to a scene. Also the tool for glass panels, ambient glow accents, and drop-shadowed cards - see blurPx/backdropBlurPx/boxShadow.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          shape: { type: "string", enum: ["rectangle", "circle"] },
          fill: {
            type: "string",
            description: "Use an rgba() with alpha < 1 (e.g. rgba(20,20,30,0.45)) for a glass panel.",
          },
          gradient: {
            type: "object",
            description: "Overrides fill with a CSS linear-gradient.",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              angleDeg: { type: "number" },
            },
          },
          x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
          y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
          width: { type: "number", description: "Percent of canvas width (0-100). Use x:0,y:0,width:100,height:100 for a full-screen background." },
          height: { type: "number", description: "Percent of canvas height (0-100)." },
          borderRadius: { type: "number", description: "Pixels. 16-24 reads as a modern rounded card." },
          blurPx: {
            type: "number",
            description: "Self-blur (soft glow) - use on a large, low-opacity, saturated-color circle behind other content for an ambient background accent. Try 60-120.",
          },
          backdropBlurPx: {
            type: "number",
            description: "Frosted-glass blur of whatever is BEHIND this shape. Pair with a semi-transparent fill for a glassmorphic panel. Try 12-24.",
          },
          boxShadow: {
            type: "string",
            description: "Raw CSS box-shadow for lift/depth, e.g. '0 20px 60px rgba(0,0,0,0.45)'.",
          },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
        },
        required: ["sceneId", "shape"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_custom_element",
      description:
        "Add arbitrary HTML/CSS/JS/SVG to a scene, rendered in an isolated iframe. Inline SVG is a first-class use of this tool, not an afterthought - custom icons, shapes, patterns, data visualizations, and hand-built graphics are all normal, static SVG markup placed directly in the html field (e.g. '<svg viewBox=\"0 0 100 100\">...</svg>'), and render exactly as reliably as plain HTML/CSS. Also use this for custom layouts or effects the built-in element types (text/image/video/shape) don't cover. IMPORTANT: static HTML/CSS/SVG renders reliably in both the live preview and the final exported video. JS-driven or CSS transition/keyframe animation inside it plays correctly in the live preview (real browser playback) but is NOT guaranteed to render correctly frame-by-frame in a final export - prefer add_animation on a built-in element (SVG included) for anything that must be correct in the exported video file. Use this tool for static rich content, not as the default way to add motion.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          html: { type: "string", description: "HTML markup for the element's body - inline SVG belongs here too, e.g. '<svg>...</svg>'." },
          css: { type: "string", description: "CSS rules, scoped to this element automatically (isolated iframe - no need to prefix selectors)." },
          js: { type: "string", description: "Optional JS - see the export-reliability warning above." },
          transparentBackground: { type: "boolean", description: "Default true. Set false for an opaque black backdrop." },
          x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
          y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
          width: { type: "number", description: "Percent of canvas width (0-100)." },
          height: { type: "number", description: "Percent of canvas height (0-100)." },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
        },
        required: ["sceneId", "html"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_custom_element_code",
      description:
        "Make a targeted edit to an existing custom element's html/css/js WITHOUT rewriting the whole thing - like a find-and-replace. Give the exact text to find (oldText) and what to replace it with (newText). oldText must match the current content EXACTLY ONCE - if it matches zero or multiple times, this fails and tells you so; widen oldText with a bit of surrounding context until it's unique, the same way you'd narrow down a search. Use this for any modification to a custom element the user already has (\"change the button color\", \"make the icon bigger\") instead of calling update_element with a completely regenerated html/css/js string - regenerating the whole thing from memory risks losing or subtly changing parts the user didn't ask you to touch.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elementId: { type: "string" },
          field: { type: "string", enum: ["html", "css", "js"] },
          oldText: { type: "string", description: "Exact text to find - must be unique within the field." },
          newText: { type: "string", description: "Replacement text. Empty string deletes the matched text." },
        },
        required: ["sceneId", "elementId", "field", "oldText", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_element",
      description:
        "Patch any properties on an existing element (position, size, color, text, timing, etc). Position/size fields (x/y/width/height) are percent of canvas (0-100), not pixels. Only send the fields you want changed.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elementId: { type: "string" },
          patch: { type: "object", description: "Partial object of fields to overwrite." },
        },
        required: ["sceneId", "elementId", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_element",
      description: "Delete an element from a scene.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elementId: { type: "string" },
        },
        required: ["sceneId", "elementId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_animation",
      description:
        "Attach a keyframe animation to an element (e.g. fade in, slide in, scale pop).",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elementId: { type: "string" },
          property: { type: "string", enum: ["opacity", "x", "y", "scale", "rotation"] },
          from: {
            type: "number",
            description:
              "For x/y: percent of canvas width/height, as an OFFSET from the element's resting position (e.g. 5 = start 5% of canvas height/width away). For opacity: 0-1. For scale: a multiplier (1 = normal size). For rotation: degrees.",
          },
          to: { type: "number", description: "Same units as 'from' for the chosen property." },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
          easing: {
            type: "string",
            enum: ["linear", "easeIn", "easeOut", "easeInOut", "spring", "bounce", "elastic"],
            description: "spring=overshoots then settles (icon pops, badges). bounce=hits target then rebounds (playful). elastic=snaps past and oscillates (attention-grabbing). easeOut=default smooth decel.",
          },
          loop: { type: "boolean", description: "Repeat this animation indefinitely or N times within the element's lifetime. Great for pulse/spin/breathe effects." },
          loopCount: { type: "number", description: "0=infinite (default when loop:true), N=repeat N extra times after the first play." },
        },
        required: ["sceneId", "elementId", "property", "from", "to", "startFrame", "durationInFrames"],
      },
    },
  },
  addEntranceAnimationDef,
  addExitAnimationDef,
  addInOutAnimationDef,
  removeAnimationDef,
  {
    type: "function",
    function: {
      name: "set_scene_transition",
      description:
        "Set how a scene transitions IN from the previous scene (fade, slide, wipe, flip, or clockWipe) instead of a hard cut. Has no effect on the first scene. Use this on every scene after the first for a polished, professional-looking video - vary the type across the project rather than reusing one everywhere.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          type: { type: "string", enum: ["fade", "slide", "wipe", "flip", "clockWipe", "none"] },
          direction: {
            type: "string",
            enum: ["from-left", "from-right", "from-top", "from-bottom"],
            description: "Used by slide, wipe, and flip. Ignored by fade and clockWipe.",
          },
          durationInFrames: { type: "number", description: "Typically 12-20 frames." },
        },
        required: ["sceneId", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_composition_meta",
      description: "Change project-wide settings: name, fps, width, height.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          fps: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_scene",
      description: "Rename a scene or change its duration/background color after creation.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          name: { type: "string" },
          durationInFrames: { type: "number" },
          backgroundColor: { type: "string" },
        },
        required: ["sceneId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_scene",
      description: "Delete a scene and everything in it.",
      parameters: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_scene",
      description:
        "Clone an existing scene (with all its elements and animations) as a starting point for a new one. Much more reliable than rebuilding a similar scene from scratch - use this to reuse a title style, layout, or background across scenes.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string", description: "The scene to clone." },
          newName: { type: "string" },
        },
        required: ["sceneId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_scene",
      description:
        "Create a fully-populated scene - background, every element, their animations, and its transition - in ONE call, instead of many small tool calls. Prefer this over add_scene + add_*_element + add_animation one at a time whenever you already know the whole scene you want to build; it's faster and less error-prone.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          durationInFrames: { type: "number" },
          backgroundColor: { type: "string" },
          transitionIn: {
            type: "object",
            description: "Omit for a hard cut on the first scene.",
            properties: {
              type: { type: "string", enum: ["fade", "slide", "wipe", "flip", "clockWipe"] },
              direction: {
                type: "string",
                enum: ["from-left", "from-right", "from-top", "from-bottom"],
              },
              durationInFrames: { type: "number" },
            },
          },
          elements: {
            type: "array",
            description: "Every element in the scene, back to front is not required - zIndex is inferred from array order unless a shape/video is meant as background (put those first).",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["text", "image", "video", "shape", "custom"] },
                x: { type: "number", description: "Percent of canvas width from the left (0-100), not pixels." },
                y: { type: "number", description: "Percent of canvas height from the top (0-100), not pixels." },
                width: { type: "number", description: "Percent of canvas width (0-100). Use 100 for full-bleed." },
                height: { type: "number", description: "Percent of canvas height (0-100). Use 100 for full-bleed." },
                startFrame: { type: "number" },
                durationInFrames: { type: "number" },
                text: { type: "string", description: "text kind only" },
                fontSize: { type: "number" },
                fontFamily: {
                  type: "string",
                  description: "Must be one of the font names listed in the system prompt's FONTS section.",
                },
                fontWeight: { type: "number" },
                color: { type: "string" },
                textAlign: { type: "string", enum: ["left", "center", "right"] },
                letterSpacing: { type: "number" },
                textShadow: { type: "boolean" },
                highlightColor: { type: "string" },
                src: { type: "string", description: "image/video kind only" },
                html: { type: "string", description: "custom kind only - HTML markup." },
                css: { type: "string", description: "custom kind only - CSS, isolated automatically." },
                js: { type: "string", description: "custom kind only - see export-reliability warning on add_custom_element." },
                transparentBackground: { type: "boolean", description: "custom kind only. Default true." },
                shape: { type: "string", enum: ["rectangle", "circle"], description: "shape kind only" },
                fill: { type: "string" },
                gradient: {
                  type: "object",
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    angleDeg: { type: "number" },
                  },
                },
                borderRadius: { type: "number", description: "Pixels, for image/shape. 16-24 reads as a modern rounded card." },
                blurPx: { type: "number", description: "shape only - self-blur for a soft ambient glow accent (try 60-120)." },
                backdropBlurPx: { type: "number", description: "shape only - frosted-glass blur of what's behind it; pair with a semi-transparent fill (try 12-24)." },
                boxShadow: { type: "string", description: "Raw CSS box-shadow for lift/depth, e.g. '0 20px 60px rgba(0,0,0,0.45)'. image/shape only." },
                animations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      property: { type: "string", enum: ["opacity", "x", "y", "scale", "rotation"] },
                      from: {
                        type: "number",
                        description:
                          "For x/y: percent-of-canvas offset from resting position. For opacity: 0-1. For scale: multiplier. For rotation: degrees.",
                      },
                      to: { type: "number" },
                      startFrame: { type: "number" },
                      durationInFrames: { type: "number" },
                      easing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut", "spring", "bounce", "elastic"] },
                      loop: { type: "boolean" },
                      loopCount: { type: "number" },
                    },
                    required: ["property", "from", "to", "startFrame", "durationInFrames"],
                  },
                },
              },
              required: ["kind"],
            },
          },
        },
        required: ["name", "durationInFrames", "elements"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web (via DuckDuckGo, free, no key needed) for current facts, news, or topic research to inform video content - use this instead of relying on what you already know when the request needs up-to-date or specific information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_stock_images",
      description:
        "Search real, licensed stock photos (Pexels) and get back working, hotlink-safe image URLs. ALWAYS use this to find an image's src instead of guessing or recalling a URL from training - invented URLs are broken URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          orientation: { type: "string", enum: ["landscape", "portrait", "square"] },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_stock_videos",
      description:
        "Search real, licensed stock video clips (Pexels) and get back working video file URLs - useful for b-roll/backdrop footage in a video element. ALWAYS use this instead of guessing a video URL.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          orientation: { type: "string", enum: ["landscape", "portrait", "square"] },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_url",
      description:
        "Verify a URL actually resolves before using it as an image/video src. Use this if you're not fully sure a URL (e.g. one you didn't get from search_stock_images/search_stock_videos) is real and reachable.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_storyboard",
      description:
        "Write the project's storyboard/plan BEFORE building anything - concept, narrative arc, mood direction, creative brief, and a detailed scene-by-scene breakdown. Do this first for any real request ('a video about X', 'a promo for Y') so the build has a coherent, information-rich plan behind it instead of a couple of generic caption scenes. Research the topic first (web_search/wikipedia_lookup) so contentNotes has real facts, not placeholders. Pass a 'brief' with the project's genre, target platform, and designLanguage (palette/typeScale/margin) so every scene can hold to the same design language. Each scene should specify shotType, visualTreatment, targetDurationInFrames, and dependencies. The user can view and download this plan. Overwrites any existing storyboard.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          concept: { type: "string", description: "1-2 sentences: what is this video, and why does it work for the request." },
          narrativeArc: {
            type: "string",
            description: "How the video builds across its full length - what it opens with, how it develops, what it builds to. A real arc, not just a scene list.",
          },
          moodDirection: {
            type: "string",
            description: "The specific visual/tonal direction for THIS project - colors, pacing, typography feel, energy level. Be concrete and specific to this project, not a generic description - this is what should make different projects look different from each other.",
          },
          brief: {
            type: "object",
            description: "The creative brief: who's it for, where will it play, what aspect ratio, what genre, and what design language to hold to. Pass aspectRatio and the tool will set the composition dimensions to match (so you don't have to call set_orientation separately).",
            properties: {
              targetAudience: { type: "string" },
              platform: { type: "string", description: "e.g. 'YouTube', 'TikTok', 'LinkedIn', 'in-store display'." },
              aspectRatio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3", "21:9"] },
              targetDurationSeconds: { type: "number" },
              genre: {
                type: "string",
                enum: ["corporate", "social-reel", "documentary", "cinematic", "kids", "product-launch", "educational", "other"],
                description: "The closest match. Drives the type/motion/pacing recommendations in the design playbook.",
              },
              designLanguage: {
                type: "object",
                description: "Structured design language - palette, type pair, margin grid, type scale, motion vocabulary. Once set, plan_scene_layout will read these from the storyboard automatically (no need to pass designTokens on every call).",
                properties: {
                  palette: { type: "array", items: { type: "string" }, description: "2-4 hex colors: dominant field, accent, text. Don't pass more than 4." },
                  typePair: {
                    type: "object",
                    properties: { display: { type: "string" }, body: { type: "string" } },
                    description: "One display font and one body font. e.g. { display: 'Manrope', body: 'Inter' }.",
                  },
                  margin: { type: "number", description: "Edge margin in percent of canvas (0-20). Default 8." },
                  typeScale: {
                    type: "object",
                    properties: { display: { type: "number" }, body: { type: "number" }, kicker: { type: "number" } },
                    description: "Suggested sizes for display/headline, body, and kicker. e.g. { display: 72, body: 28, kicker: 18 }.",
                  },
                  motionVocabulary: { type: "array", items: { type: "string" }, description: "The motion techniques the project will use, e.g. ['fade-up', 'fade-in', 'ken-burns']." },
                },
              },
            },
          },
          scenes: {
            type: "array",
            description: "For a substantive topic, plan enough scenes to actually cover it (often 6-10+) - don't compress a rich subject into 2-3 scenes.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                purpose: { type: "string", description: "What this scene needs to communicate/accomplish." },
                narrativeBeat: { type: "string", description: "How this scene connects to the one before and after it - what story point it delivers." },
                contentNotes: {
                  type: "string",
                  description: "The actual information/copy for this scene - specific facts, figures, names, dates from your research. Not 'add some facts about the pyramids' - the actual facts themselves, ready to become on-screen text.",
                },
                keyElements: { type: "string", description: "The main visual elements planned for this scene, specific enough to build from." },
                transitionNote: { type: "string", description: "How it enters from the previous scene, and why that fits." },
                animationNote: { type: "string", description: "The specific motion planned - not just 'it animates in'." },
                shotType: { type: "string", enum: ["establishing", "wide", "medium", "closeUp", "detail"] },
                visualTreatment: { type: "string", description: "Free-form visual direction, e.g. 'split layout, image left, glass-panel-right with caption' or 'centered headline with two stat callouts below'." },
                targetDurationInFrames: { type: "number", description: "How long this scene should be. e.g. 90 for 3s at 30fps." },
                entranceCue: { type: "string", description: "What triggers this scene's entrance, e.g. 'after fade', 'after slide from right'." },
                audioCue: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["voiceover", "music", "sfx", "silence"] },
                    description: { type: "string" },
                    startFrame: { type: "number" },
                  },
                },
                dependencies: { type: "array", items: { type: "string" }, description: "Names of other scenes whose visual elements should carry over (e.g. recurring brand mark, character)." },
              },
              required: ["name", "purpose", "keyElements"],
            },
          },
        },
        required: ["title", "concept", "moodDirection", "scenes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "review_scene",
      description:
        "Get a structured, pre-analyzed report on a scene you just built - element bounding boxes sorted by layer, flagged overlaps (e.g. a shape stacked above text that may cover it), whether anything is visible at frame 0, and out-of-bounds elements. Call this after building each scene and actually reason about any flags returned - fix them with update_element/add_animation before moving to the next scene. Don't call this and ignore the output.",
      parameters: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_scene_layout",
      description: planSceneLayoutDef.function.description,
      parameters: planSceneLayoutDef.function.parameters,
    },
  },
  {
    type: "function",
    function: {
      name: "reorder_layer",
      description:
        "Move an element to the front or back of its scene's stacking order. Use this instead of guessing a zIndex number when review_scene flags a layering problem (e.g. a shape covering text that should be readable).",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elementId: { type: "string" },
          position: { type: "string", enum: ["front", "back"] },
        },
        required: ["sceneId", "elementId", "position"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wikipedia_lookup",
      description:
        "Get a reliable, structured factual summary of a well-known topic (history, places, people, events) from Wikipedia - free, no key. More reliable for solid facts than a general web search. Use language 'ar' for Arabic content, 'en' for English, etc.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The Wikipedia article title, e.g. 'Great Pyramid of Giza'." },
          language: { type: "string", description: "Wikipedia language code, default 'en'." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page_content",
      description:
        "Read the full text of a specific web page — including JS-rendered sites, React/Next.js apps, news articles, and product pages — via Jina.ai Reader (free). Returns clean Markdown, not raw HTML. Use when a search snippet isn't enough detail. Falls back to static scraping if Jina is unavailable.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_contrast",
      description:
        "Check WCAG contrast ratio between a text color and its background before finalizing them - catches text that will be hard to read. Use for any non-obvious color pairing (light text on a mid-tone photo, colored text on a colored highlight, etc).",
      parameters: {
        type: "object",
        properties: {
          foreground: { type: "string", description: "Text color, hex or rgb()." },
          background: { type: "string", description: "Background/highlight color behind it, hex or rgb()." },
        },
        required: ["foreground", "background"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_ai_image",
      description:
        "Generate a custom AI image for something a stock photo won't have - a specific illustration, an abstract background, a particular creative concept. Returns a real, usable image URL. Prefer search_stock_images for realistic photography; use this when you need something stock photos don't cover. May be rate-limited without POLLINATIONS_API_KEY configured - if it errors, tell the user rather than falling back to a guessed URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Describe the image in detail - style, subject, mood, composition." },
          width: { type: "number", description: "Default 1920." },
          height: { type: "number", description: "Default 1080." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_voiceover",
      description:
        "Generate spoken narration audio from text - for documentary/explainer-style voiceover. Returns a real, usable audio URL - use it with add_audio_element. Often needs POLLINATIONS_API_KEY configured even for a single request - if it errors, tell the user rather than skipping narration silently or inventing an audio URL.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          voice: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], description: "Default 'nova'." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_audio_element",
      description: "Add a voiceover or music track to a scene - src from generate_voiceover, search_free_music, or a URL you've verified with check_url.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          src: { type: "string", description: "Direct audio URL from generate_voiceover or search_free_music." },
          volume: { type: "number", description: "0-1, default 1. Use 0.3-0.5 for background music under voiceover." },
          startFrame: { type: "number" },
          durationInFrames: { type: "number" },
          name: { type: "string", description: "Descriptive name, e.g. 'Voiceover Scene 1' or 'Background Music'." },
        },
        required: ["sceneId", "src"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_global_audio",
      description:
        "Add a background music or audio track that plays continuously across the ENTIRE video composition (across all scenes), without restarting on scene changes.",
      parameters: {
        type: "object",
        properties: {
          src: { type: "string", description: "Direct MP3/audio URL from search_free_music, generate_voiceover, or check_url." },
          volume: { type: "number", description: "Volume level 0-1 (default 0.4 for background music under voiceover)." },
          startFrame: { type: "number", description: "Composition frame to start playing at (default 0)." },
          durationInFrames: { type: "number", description: "Duration in frames to play. Defaults to full video length." },
          name: { type: "string", description: "Descriptive name, e.g. 'Background Music'." },
        },
        required: ["src"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_global_audio",
      description: "Remove a global background audio track by ID.",
      parameters: {
        type: "object",
        properties: {
          audioId: { type: "string", description: "ID of global audio track to remove." },
        },
        required: ["audioId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_global_audio",
      description: "List all active global audio tracks (background music / composition-wide audio).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "batch_update_scenes",
      description:
        "Apply changes across MULTIPLE scenes in one call. Supports combining backgroundColor, durationInFrames, a transitionIn to apply to every scene boundary (so the whole video has a uniform feel), and a namePrefix/nameSuffix. Use this instead of calling update_scene 12 times for a project-wide change. The first scene has no incoming transition; pass skipFirst:true to leave it alone while applying a transition to all later scenes.",
      parameters: {
        type: "object",
        properties: {
          backgroundColor: { type: "string", description: "Hex/CSS background color to apply to all scenes (e.g. '#0a0e27')." },
          durationInFrames: { type: "number", description: "Duration in frames to set for all scenes (e.g. 150). Must be > 0." },
          transitionIn: {
            type: "object",
            description: "Apply the same transition to every scene boundary (or every scene except the first if skipFirst is true). type 'none' clears the transition on those scenes.",
            properties: {
              type: { type: "string", enum: ["fade", "slide", "wipe", "flip", "clockWipe", "none"] },
              direction: { type: "string", enum: ["from-left", "from-right", "from-top", "from-bottom"] },
              durationInFrames: { type: "number" },
            },
            required: ["type"],
          },
          namePrefix: { type: "string", description: "Prepend this string to every scene's name (e.g. 'v2 - ')." },
          nameSuffix: { type: "string", description: "Append this string to every scene's name (e.g. ' (draft)')." },
          skipFirst: { type: "boolean", description: "When applying transitionIn, leave the first scene's transition alone (it has no previous scene to transition from). Defaults to false." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_free_music",
      description:
        "Search for free, Creative Commons–licensed background music tracks (Jamendo) by genre or mood. Returns direct MP3 URLs ready to use with add_audio_element or add_global_audio. Requires JAMENDO_CLIENT_ID in .env — if not configured, this tool errors with clear instructions. Good queries: 'cinematic epic', 'calm ambient', 'upbeat corporate', 'lo-fi study', 'dramatic orchestral'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Genre or mood, e.g. 'ambient background', 'epic cinematic', 'corporate upbeat'.",
          },
          limit: { type: "number", description: "Max tracks to return, default 5." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_sound_effect",
      description:
        "Search for short sound effects (Freesound MP3s) for UI element entrances, animations, pop-ins, clicks, whooshes, risers, transitions, and accent effects. Returns direct audio URLs ready to use with add_audio_element.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Sound effect type or keyword, e.g. 'whoosh', 'swoosh', 'pop', 'click', 'cinematic boom', 'chime', 'glitch', 'digital riser'.",
          },
          maxDuration: { type: "number", description: "Max duration in seconds (e.g. 2 for short FX)." },
          limit: { type: "number", description: "Max results, default 6." },
        },
        required: ["query"],
      },
    },
  },
  setAllTransitionsDef,
  setSceneTransitionsDef,
  duplicateElementDef,
  nudgeElementDef,
  timelineOverviewDef,
  fitTextToBoxDef,
  previewSingleSceneDef,
  diagnoseSceneDef,
  auditSceneDef,
  setAnimationTimingDef,
  addLineDef,
  addBorderDef,
  editDurationDef,
  editTimingDef,
  applyTemplateDef,
  saveSceneAsTemplateDef,
  listTemplatesDef,
  deleteTemplateDef,
  suggestTemplatesDef,
] as const;

function findScene(scenes: Scene[], sceneId: string): Scene {
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`No scene with id "${sceneId}". Call list_scenes to see valid ids.`);
  return scene;
}

/** Actual implementations. Keys must match toolDefinitions[].function.name. */
export const toolImplementations: Record<string, (args: any) => Promise<unknown>> = {
  async list_scenes() {
    const composition = sceneStore.get();
    return composition.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      durationInFrames: scene.durationInFrames,
      elements: scene.elements.map((el) => ({
        id: el.id,
        type: el.type,
        name: el.name,
        startFrame: el.startFrame,
        durationInFrames: el.durationInFrames,
      })),
    }));
  },

  /**
   * Fetch the full state of a single scene: every element with all its
   * fields, every animation, the transition, and the surrounding scene
   * context. This is the "show me the complete data of this scene, not
   * just a flag list" tool — complementary to review_scene (which gives
   * analysis) and list_scenes (which gives a one-line-per-element
   * summary of every scene).
   *
   * Why this exists: agents routinely need to inspect or modify a
   * specific scene's contents in detail (e.g. "what text content is in
   * scene 2 right now?", "what's the source URL of the image in scene
   * 3?", "what easing does the entrance use?"). list_scenes omits that
   * detail; review_scene skips raw data in favor of polish flags. The
   * model kept calling list_scenes and stitching together the answer
   * from the truncated fields, which lost information. get_scene gives
   * back the full element objects exactly as stored.
   *
   * includeAnimations: defaults true. The animations array can be large;
   * pass false if you only need layout/static state. transitionIn and
   * transitionOut are always included since they're rarely large.
   *
   * The response shape mirrors the Scene type as closely as is useful.
   */
  async get_scene(args: {
    sceneId: string;
    /** When false, omit element.animations to keep the response small. Default true. */
    includeAnimations?: boolean;
  }) {
    const composition = sceneStore.get();
    const scene = composition.scenes.find((s) => s.id === args.sceneId);
    if (!scene) {
      const known = composition.scenes.map((s) => s.id).join(", ");
      throw new Error(
        `get_scene: no scene with id "${args.sceneId}". Existing scene ids: ` +
          (known ? known : "(none)"),
      );
    }
    const index = composition.scenes.findIndex((s) => s.id === args.sceneId);
    const includeAnimations = args.includeAnimations !== false;
    return {
      id: scene.id,
      index,
      name: scene.name,
      durationInFrames: scene.durationInFrames,
      backgroundColor: scene.backgroundColor,
      /** Transition INTO this scene (set on the previous scene's transitionOut). */
      transitionIn: scene.transitionIn ?? null,
      /** Transition OUT of this scene into the next one. */
      transitionOut: scene.transitionOut ?? null,
      elements: scene.elements.map((el) => {
        const base: Record<string, unknown> = {
          id: el.id,
          type: el.type,
          name: el.name,
          zIndex: "zIndex" in el ? (el as { zIndex?: number }).zIndex : undefined,
          startFrame: el.startFrame,
          durationInFrames: el.durationInFrames,
          opacity: "opacity" in el ? (el as { opacity?: number }).opacity : undefined,
        };
        // Layout fields (x/y/w/h are percent, always per-element)
        for (const k of ["x", "y", "width", "height"] as const) {
          if (k in el) base[k] = (el as Record<string, unknown>)[k];
        }
        // Style fields common across visual elements
        for (const k of [
          "borderRadius",
          "boxShadow",
          "gradient",
          "objectFit",
          "backgroundColor",
          "color",
          "fontFamily",
          "fontWeight",
          "fontSize",
          "textAlign",
          "text",
          "src",
          "code",
        ] as const) {
          if (k in el) base[k] = (el as Record<string, unknown>)[k];
        }
        if (includeAnimations) {
          base.animations = "animations" in el ? el.animations : [];
        }
        return base;
      }),
      /** Adjacent scenes so the agent can reason about sequence/pacing in one call. */
      previousSceneId: index > 0 ? composition.scenes[index - 1].id : null,
      nextSceneId: index < composition.scenes.length - 1 ? composition.scenes[index + 1].id : null,
      totalScenes: composition.scenes.length,
    };
  },

  async sequential_thinking(args: any) {
    return await sequentialThinkingImpl(args);
  },

  async add_scene(args: { name: string; durationInFrames: number; backgroundColor?: string }) {
    const scene: Scene = {
      id: `scene-${nanoid(6)}`,
      name: args.name,
      durationInFrames: args.durationInFrames,
      backgroundColor: args.backgroundColor ?? "#0b0b0f",
      elements: [],
      locked: false,
      solo: false,
      collapsed: false,
    };
    await sceneStore.update((draft) => {
      draft.scenes.push(scene);
      return draft;
    });
    return { sceneId: scene.id };
  },

  async add_text_element(args: any) {
    const element: TextElement = {
      id: `el-${nanoid(6)}`,
      type: "text",
      name: args.text?.slice(0, 24) ?? "Text",
      text: args.text,
      x: args.x ?? 10,
      y: args.y ?? 40,
      width: args.width ?? 80,
      height: args.height ?? 20,
      fontSize: args.fontSize ?? 48,
      fontFamily: args.fontFamily ?? "Inter",
      fontWeight: args.fontWeight ?? 600,
      color: args.color ?? "#ffffff",
      textAlign: args.textAlign ?? "center",
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 90,
      letterSpacing: args.letterSpacing ?? 0,
      textShadow: args.textShadow ?? false,
      highlightColor: args.highlightColor,
      strokeColor: args.strokeColor,
      strokeWidth: args.strokeWidth ?? 0,
      gradient: args.gradient,
      animations: [],
      locked: false,
      hidden: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async add_image_element(args: any) {
    // Reject data: URLs at the tool boundary. Data URLs render in the
    // live preview (the browser handles data: natively) but Remotion's
    // <Img> renderer does not reliably embed them into the exported
    // MP4 frames, and embedding them in the composition JSON balloons
    // it to MBs. The user-attached image flow now saves data URLs to
    // public/uploads/ on the server and exposes the saved URL via the
    // system prompt - the agent should always copy that saved URL.
    if (typeof args.src === "string" && args.src.startsWith("data:")) {
      throw new Error(
        `add_image_element: src is a base64 data: URL, which fails in the exported video. ` +
          `If the user attached an image to this chat, the system prompt lists the saved URL ` +
          `(e.g. "/uploads/abc.jpg") - use that instead. ` +
          `If you generated the image with generate_ai_image, use the URL it returned (it is already a real URL).`,
      );
    }
    const element: ImageElement = {
      id: `el-${nanoid(6)}`,
      type: "image",
      name: "Image",
      src: args.src,
      x: args.x ?? 0,
      y: args.y ?? 0,
      width: args.width ?? 100,
      height: args.height ?? 100,
      objectFit: args.objectFit ?? "cover",
      borderRadius: args.borderRadius ?? 0,
      boxShadow: args.boxShadow,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 90,
      animations: [],
      locked: false,
      hidden: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async remove_background(args: any) {
    return await backgroundRemovalImpl(args);
  },

  async add_video_element(args: any) {
    const element: VideoElement = {
      id: `el-${nanoid(6)}`,
      type: "video",
      name: "Video",
      src: args.src,
      x: args.x ?? 0,
      y: args.y ?? 0,
      width: args.width ?? 100,
      height: args.height ?? 100,
      volume: 1,
      muted: args.muted ?? false,
      objectFit: "cover",
      playbackRate: 1,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 150,
      animations: [],
      locked: false,
      hidden: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async add_shape_element(args: any) {
    const element: ShapeElement = {
      id: `el-${nanoid(6)}`,
      type: "shape",
      name: "Shape",
      shape: args.shape ?? "rectangle",
      fill: args.fill ?? "#D97757",
      gradient: args.gradient,
      borderRadius: args.borderRadius ?? 0,
      strokeWidth: 0,
      blurPx: args.blurPx ?? 0,
      backdropBlurPx: args.backdropBlurPx ?? 0,
      boxShadow: args.boxShadow,
      x: args.x ?? 0,
      y: args.y ?? 0,
      width: args.width ?? 30,
      height: args.height ?? 30,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 90,
      animations: [],
      locked: false,
      hidden: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async add_custom_element(args: any) {
    const element: CustomElement = {
      id: `el-${nanoid(6)}`,
      type: "custom",
      name: "Custom",
      html: args.html ?? "",
      css: args.css ?? "",
      js: args.js,
      transparentBackground: args.transparentBackground ?? true,
      x: args.x ?? 10,
      y: args.y ?? 10,
      width: args.width ?? 80,
      height: args.height ?? 80,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 90,
      animations: [],
      locked: false,
      hidden: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async edit_custom_element_code(args: {
    sceneId: string;
    elementId: string;
    field: "html" | "css" | "js";
    oldText: string;
    newText: string;
  }) {
    let result: { ok: true } | undefined;

    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      const element = scene.elements.find((e) => e.id === args.elementId);
      if (!element) throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);
      if (element.type !== "custom") {
        throw new Error(`Element "${args.elementId}" is type "${element.type}", not "custom" - edit_custom_element_code only works on custom elements.`);
      }

      const current = element[args.field] ?? "";
      const occurrences = current.split(args.oldText).length - 1;

      if (occurrences === 0) {
        throw new Error(
          `oldText was not found in ${args.field}. Current ${args.field}:\n${current}`,
        );
      }
      if (occurrences > 1) {
        throw new Error(
          `oldText matches ${occurrences} times in ${args.field} - it must be unique. Add more surrounding context to oldText and try again.`,
        );
      }

      element[args.field] = current.replace(args.oldText, args.newText);
      result = { ok: true };
      return draft;
    });

    return result;
  },

  async update_element(args: { sceneId: string; elementId: string; patch: Record<string, unknown> }) {
    let nextElement: SceneElement | undefined;
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      const idx = scene.elements.findIndex((e) => e.id === args.elementId);
      if (idx === -1) throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);
      const merged = { ...scene.elements[idx], ...args.patch };
      // Validate the merged element against the schema. The agent used to hit
      // silent failures here (e.g. durationInFrames:0, x:200) that broke
      // rendering later with no useful error - now we fail fast with the
      // exact fields and reasons, and the agent can fix the call.
      validateElementPatch(args.sceneId, args.elementId, merged);
      scene.elements[idx] = merged as typeof scene.elements[number];
      nextElement = scene.elements[idx];
      return draft;
    });
    return { ok: true, element: nextElement };
  },

  async remove_element(args: { sceneId: string; elementId: string }) {
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      scene.elements = scene.elements.filter((e) => e.id !== args.elementId);
      return draft;
    });
    return { ok: true };
  },

  async add_animation(args: {
    sceneId: string;
    elementId: string;
    property: Animation["property"];
    from: number;
    to: number;
    startFrame: number;
    durationInFrames: number;
    easing?: Animation["easing"];
  }) {
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      const element = scene.elements.find((e) => e.id === args.elementId);
      if (!element) throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);
      element.animations.push({
        id: `anim-${nanoid(6)}`,
        property: args.property,
        from: args.from,
        to: args.to,
        startFrame: args.startFrame,
        durationInFrames: args.durationInFrames,
        easing: args.easing ?? "easeInOut",
      });
      return draft;
    });
    return { ok: true };
  },

  async add_entrance_animation(args: any) {
    return await addEntranceAnimationImpl(args);
  },

  async add_exit_animation(args: any) {
    return await addExitAnimationImpl(args);
  },

  async add_in_out_animation(args: any) {
    return await addInOutAnimationImpl(args);
  },

  async remove_animation(args: any) {
    return await removeAnimationImpl(args);
  },

  async set_scene_transition(args: {
    sceneId: string;
    type: "fade" | "slide" | "wipe" | "flip" | "clockWipe" | "none";
    direction?: "from-left" | "from-right" | "from-top" | "from-bottom";
    durationInFrames?: number;
  }) {
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      scene.transitionIn =
        args.type === "none"
          ? undefined
          : {
              type: args.type,
              direction: args.direction ?? "from-right",
              durationInFrames: args.durationInFrames ?? 15,
            };
      return draft;
    });
    return { ok: true };
  },

  async set_scene_transitions(args: any) {
    return await setSceneTransitionsImpl(args);
  },

  async set_composition_meta(args: { name?: string; fps?: number; width?: number; height?: number }) {
    await sceneStore.update((draft) => {
      if (args.name) draft.name = args.name;
      if (args.fps) draft.fps = args.fps;
      if (args.width) draft.width = args.width;
      if (args.height) draft.height = args.height;
      return draft;
    });
    return { ok: true };
  },

  async update_scene(args: {
    sceneId: string;
    name?: string;
    durationInFrames?: number;
    backgroundColor?: string;
  }) {
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      if (args.name) scene.name = args.name;
      if (args.durationInFrames) scene.durationInFrames = args.durationInFrames;
      if (args.backgroundColor) scene.backgroundColor = args.backgroundColor;
      return draft;
    });
    return { ok: true };
  },

  async remove_scene(args: { sceneId: string }) {
    await sceneStore.update((draft) => {
      draft.scenes = draft.scenes.filter((s) => s.id !== args.sceneId);
      return draft;
    });
    return { ok: true };
  },

  async duplicate_scene(args: { sceneId: string; newName?: string }) {
    let newSceneId = "";
    await sceneStore.update((draft) => {
      const source = findScene(draft.scenes, args.sceneId);
      const cloned: Scene = {
        ...structuredClone(source),
        id: `scene-${nanoid(6)}`,
        name: args.newName ?? `${source.name} copy`,
        elements: source.elements.map((el) => ({
          ...structuredClone(el),
          id: `el-${nanoid(6)}`,
        })),
      };
      newSceneId = cloned.id;
      const sourceIndex = draft.scenes.findIndex((s) => s.id === args.sceneId);
      draft.scenes.splice(sourceIndex + 1, 0, cloned);
      return draft;
    });
    return { sceneId: newSceneId };
  },

  async build_scene(args: {
    name: string;
    durationInFrames: number;
    backgroundColor?: string;
    transitionIn?: {
      type: "fade" | "slide" | "wipe" | "flip" | "clockWipe";
      direction?: Transition["direction"];
      durationInFrames?: number;
    };
    elements: Array<Record<string, unknown> & { kind: "text" | "image" | "video" | "shape" | "custom" }>;
  }) {
    const VALID_KINDS = new Set(["text", "image", "video", "shape", "custom"]);
    args.elements.forEach((spec, i) => {
      if (!VALID_KINDS.has(spec.kind)) {
        throw new Error(
          `elements[${i}] has an invalid kind "${spec.kind}" - must be exactly one of text, image, video, shape, custom (no extra words).`,
        );
      }
      // Content kinds (not shape - a bleeding glow shape is often
      // deliberate) must actually land on-canvas. Only checked when x/y/
      // width/height were explicitly given - omitted ones get safe
      // defaults from the underlying add_*_element tool.
      if (spec.kind !== "shape" && typeof spec.x === "number" && typeof spec.y === "number") {
        const width = typeof spec.width === "number" ? spec.width : 0;
        const height = typeof spec.height === "number" ? spec.height : 0;
        const overRight = spec.x + width - 100;
        const overBottom = spec.y + height - 100;
        if (spec.x < -5 || spec.y < -5 || overRight > 5 || overBottom > 5) {
          throw new Error(
            `elements[${i}] (kind "${spec.kind}") is positioned at x:${spec.x}, y:${spec.y}, width:${width}, height:${height} - that's mostly or entirely off-canvas. Content elements need x + width <= 100 and y + height <= 100. Consider calling plan_scene_layout first to get validated positions.`,
          );
        }
      }
    });

    const sceneResult = (await toolImplementations.add_scene({
      name: args.name,
      durationInFrames: args.durationInFrames,
      backgroundColor: args.backgroundColor,
    })) as { sceneId: string };
    const sceneId = sceneResult.sceneId;

    if (args.transitionIn) {
      await toolImplementations.set_scene_transition({ sceneId, ...args.transitionIn });
    }

    for (const [index, spec] of args.elements.entries()) {
      const common = { ...spec, sceneId };
      let elementId: string | undefined;

      if (spec.kind === "text") {
        const result = (await toolImplementations.add_text_element(common)) as { elementId: string };
        elementId = result.elementId;
      } else if (spec.kind === "image") {
        const result = (await toolImplementations.add_image_element(common)) as { elementId: string };
        elementId = result.elementId;
      } else if (spec.kind === "video") {
        const result = (await toolImplementations.add_video_element(common)) as { elementId: string };
        elementId = result.elementId;
      } else if (spec.kind === "shape") {
        const result = (await toolImplementations.add_shape_element(common)) as { elementId: string };
        elementId = result.elementId;
      } else if (spec.kind === "custom") {
        const result = (await toolImplementations.add_custom_element(common)) as { elementId: string };
        elementId = result.elementId;
      }

      if (!elementId) continue;

      // Later elements default to a higher zIndex so array order reads as
      // back-to-front unless the caller already set one explicitly.
      if (typeof spec.zIndex !== "number") {
        await toolImplementations.update_element({ sceneId, elementId, patch: { zIndex: index } });
      }

      const animations = Array.isArray(spec.animations) ? spec.animations : [];
      for (const anim of animations as Array<Record<string, unknown>>) {
        await toolImplementations.add_animation({
          sceneId,
          elementId,
          property: anim.property,
          from: anim.from,
          to: anim.to,
          startFrame: anim.startFrame,
          durationInFrames: anim.durationInFrames,
          easing: anim.easing,
        });
      }
    }

    // Bug #3 from error.txt: surface a transparent-black-screen warning
    // here too so the agent sees it before moving on (review_scene is a
    // separate explicit step, but the bug is common enough to deserve a
    // hint at build time as well).
    const builtScene = sceneStore.get().scenes.find((s) => s.id === sceneId);
    const warnings: string[] = [];
    if (builtScene) {
      const blackScreen = checkTransparentBlackScreen(builtScene);
      if (blackScreen) warnings.push(blackScreen);
    }

    return { sceneId, warnings };
  },

  async web_search(args: { query: string; maxResults?: number }) {
    const results = await duckDuckGoSearch(args.query, args.maxResults ?? 6);
    return { results };
  },

  async search_stock_images(args: {
    query: string;
    orientation?: "landscape" | "portrait" | "square";
    maxResults?: number;
  }) {
    const photos = await searchStockPhotos(args.query, args.maxResults ?? 6, args.orientation);
    return { photos };
  },

  async search_stock_videos(args: {
    query: string;
    orientation?: "landscape" | "portrait" | "square";
    maxResults?: number;
  }) {
    const videos = await searchStockVideos(args.query, args.maxResults ?? 4, args.orientation);
    return { videos };
  },

  async check_url(args: { url: string }) {
    return checkUrl(args.url);
  },

  async create_storyboard(args: {
    title: string;
    concept: string;
    narrativeArc?: string;
    moodDirection: string;
    brief?: {
      targetAudience?: string;
      platform?: string;
      aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "21:9";
      targetDurationSeconds?: number;
      genre?: "corporate" | "social-reel" | "documentary" | "cinematic" | "kids" | "product-launch" | "educational" | "other";
      designLanguage?: {
        palette?: string[];
        typePair?: { display: string; body: string };
        margin?: number;
        typeScale?: { display: number; body: number; kicker: number };
        motionVocabulary?: string[];
      };
    };
    scenes: Array<{
      name: string;
      purpose: string;
      narrativeBeat?: string;
      contentNotes?: string;
      keyElements: string;
      transitionNote?: string;
      animationNote?: string;
      shotType?: "establishing" | "wide" | "medium" | "closeUp" | "detail";
      visualTreatment?: string;
      targetDurationInFrames?: number;
      entranceCue?: string;
      audioCue?: { kind: "voiceover" | "music" | "sfx" | "silence"; description: string; startFrame?: number };
      dependencies?: string[];
    }>;
  }) {
    const storyboard: Storyboard = {
      title: args.title,
      concept: args.concept,
      narrativeArc: args.narrativeArc ?? "",
      moodDirection: args.moodDirection,
      brief: args.brief as Storyboard["brief"],
      scenes: args.scenes.map((s) => ({
        name: s.name,
        purpose: s.purpose,
        narrativeBeat: s.narrativeBeat ?? "",
        contentNotes: s.contentNotes ?? "",
        keyElements: s.keyElements,
        transitionNote: s.transitionNote ?? "",
        animationNote: s.animationNote ?? "",
        shotType: s.shotType,
        visualTreatment: s.visualTreatment ?? "",
        targetDurationInFrames: s.targetDurationInFrames,
        entranceCue: s.entranceCue ?? "",
        audioCue: s.audioCue,
        dependencies: s.dependencies ?? [],
      })),
    };
    await sceneStore.update((draft) => {
      draft.storyboard = storyboard;
      if (args.title && args.title.trim()) {
        draft.name = args.title.trim();
      }
      // If the brief specifies an aspect ratio, apply the corresponding
      // preset to the composition dimensions. The agent shouldn't have
      // to call set_orientation separately - the brief is the source
      // of truth for format.
      if (args.brief?.aspectRatio) {
        const ratio = args.brief.aspectRatio;
        if (ratio === "9:16") {
          draft.orientation = "portrait";
          draft.width = 1080;
          draft.height = 1920;
        } else if (ratio === "1:1") {
          draft.orientation = "square";
          draft.width = 1080;
          draft.height = 1080;
        } else if (ratio === "16:9") {
          draft.orientation = "landscape";
          draft.width = 1920;
          draft.height = 1080;
        } else if (ratio === "4:3") {
          draft.orientation = "landscape";
          draft.width = 1440;
          draft.height = 1080;
        } else if (ratio === "21:9") {
          draft.orientation = "landscape";
          draft.width = 2520;
          draft.height = 1080;
        }
      }
      return draft;
    });
    return { ok: true };
  },

  async review_scene(args: { sceneId: string }) {
    const composition = sceneStore.get();
    const scene = findScene(composition.scenes, args.sceneId);
    const sceneIndex = composition.scenes.findIndex((s) => s.id === args.sceneId);

    const visualTypes = new Set(["text", "image", "video", "shape", "custom"]);
    const visualElements = scene.elements.filter((el) => visualTypes.has(el.type)) as Array<
      Extract<SceneElement, { x: number }>
    >;

    const elements = scene.elements.map((el) => ({
      id: el.id,
      type: el.type,
      name: el.name,
      x: "x" in el ? el.x : undefined,
      y: "y" in el ? el.y : undefined,
      width: "width" in el ? el.width : undefined,
      height: "height" in el ? el.height : undefined,
      zIndex: "zIndex" in el ? el.zIndex : undefined,
      startFrame: el.startFrame,
      durationInFrames: el.durationInFrames,
      hasEntranceAnimation: "animations" in el ? el.animations.length > 0 : false,
    }));

    const flags = computeLayoutFlags(visualElements);

    // Bug #3 from error.txt: transparent background + nothing visible at
    // frame 0 = black screen. Surface it as a flagged review item.
    const blackScreenWarning = checkTransparentBlackScreen(scene);
    if (blackScreenWarning) flags.push(blackScreenWarning);

    // Polish gaps: text-only scenes, no-motion scenes, missing transitions,
    // and the "fake hold-then-reveal" pattern (hero at startFrame 0 with
    // an opacity 0->1 fade). The agent's report explicitly listed these as
    // things the model keeps forgetting - so the review tool surfaces them
    // as concrete, actionable flags with the exact next tool to call.
    const polish = analyzePolish({
      elements: scene.elements.map((e) => ({
        id: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        startFrame: e.startFrame,
        animations: "animations" in e ? e.animations : [],
      })),
      backgroundColor: scene.backgroundColor,
      transitionIn: scene.transitionIn ?? null,
      // The transition INTO this scene is stored on the previous scene as
      // its transitionOut, but we don't model that. The transition out of
      // the previous scene into this one is the same as this scene's
      // incoming transition from the user's perspective. We approximate
      // by checking the previous scene's transitionIn vs this scene.
      previousTransitionIn:
        sceneIndex > 0 ? composition.scenes[sceneIndex - 1].transitionIn ?? null : undefined,
      hasNextScene: sceneIndex < composition.scenes.length - 1,
    });
    flags.push(...polishFlagStrings(polish));

    return { elements, flags, polish };
  },

  async plan_scene_layout(args: any) {
    return planSceneLayoutImpl(args);
  },

  async reorder_layer(args: { sceneId: string; elementId: string; position: "front" | "back" }) {
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      const target = scene.elements.find((e) => e.id === args.elementId);
      if (!target) throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);

      const zIndexes = scene.elements.map((e) => e.zIndex);
      target.zIndex = args.position === "front" ? Math.max(...zIndexes) + 1 : Math.min(...zIndexes) - 1;
      return draft;
    });
    return { ok: true };
  },

  async wikipedia_lookup(args: { title: string; language?: string }) {
    return wikipediaLookup(args.title, args.language ?? "en");
  },

  async fetch_page_content(args: { url: string }) {
    // Try Jina Reader first — handles JS-rendered SPAs and returns clean markdown.
    // Falls back to the raw cheerio scraper if Jina times out or errors.
    try {
      return await jinaReadUrl(args.url);
    } catch {
      return fetchPageContent(args.url);
    }
  },

  async check_contrast(args: { foreground: string; background: string }) {
    return checkContrast(args.foreground, args.background);
  },

  async generate_ai_image(args: { prompt: string; width?: number; height?: number }) {
    return generateImage(args.prompt, args.width ?? 1920, args.height ?? 1080);
  },

  async generate_voiceover(args: { text: string; voice?: string }) {
    return generateVoiceover(args.text, (args.voice as any) ?? "nova");
  },

  async add_audio_element(args: {
    sceneId: string;
    src: string;
    volume?: number;
    startFrame?: number;
    durationInFrames?: number;
    name?: string;
  }) {
    if (!args.sceneId) throw new Error("add_audio_element: sceneId is required.");
    if (!args.src) throw new Error("add_audio_element: src is required — use generate_voiceover or search_free_music to get a real URL.");
    const element: AudioElement = {
      id: `el-${nanoid(6)}`,
      type: "audio",
      name: args.name ?? "Audio",
      src: args.src,
      volume: args.volume ?? 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      startFrame: args.startFrame ?? 0,
      durationInFrames: args.durationInFrames ?? 150,
      animations: [],
      locked: false,
      hidden: false,
      muted: false,
    };
    await addElementToScene(args.sceneId, element);
    return { elementId: element.id };
  },

  async add_global_audio(args: {
    src: string;
    volume?: number;
    startFrame?: number;
    durationInFrames?: number;
    name?: string;
  }) {
    if (!args.src) throw new Error("add_global_audio: src is required.");
    let elementId = "";
    await sceneStore.update((draft) => {
      const totalFrames = draft.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
      const track: AudioElement = {
        id: `global-audio-${nanoid(6)}`,
        type: "audio",
        name: args.name ?? "Global Audio",
        src: args.src,
        volume: args.volume ?? 0.4,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        startFrame: args.startFrame ?? 0,
        durationInFrames: args.durationInFrames ?? Math.max(150, totalFrames),
        animations: [],
        locked: false,
        hidden: false,
        muted: false,
      };
      if (!draft.globalAudio) draft.globalAudio = [];
      draft.globalAudio.push(track);
      elementId = track.id;
      return draft;
    });
    return { success: true, audioId: elementId };
  },

  async remove_global_audio(args: { audioId: string }) {
    await sceneStore.update((draft) => {
      if (draft.globalAudio) {
        draft.globalAudio = draft.globalAudio.filter((a) => a.id !== args.audioId);
      }
      return draft;
    });
    return { success: true };
  },

  async list_global_audio() {
    const composition = sceneStore.get();
    return { globalAudio: composition.globalAudio ?? [] };
  },

  async batch_update_scenes(args: {
    backgroundColor?: string;
    durationInFrames?: number;
    transitionIn?: {
      type: "fade" | "slide" | "wipe" | "flip" | "clockWipe" | "none";
      direction?: "from-left" | "from-right" | "from-top" | "from-bottom";
      durationInFrames?: number;
    };
    namePrefix?: string;
    nameSuffix?: string;
    skipFirst?: boolean;
  }) {
    const updated: string[] = [];
    const skipped: string[] = [];
    await sceneStore.update((draft) => {
      draft.scenes.forEach((scene, index) => {
        // First scene has no incoming transition; skipTransitionFirst lets
        // you apply a uniform transition to all boundaries except the very
        // first one (which has no previous scene to transition from).
        if (args.transitionIn) {
          if (args.skipFirst && index === 0) {
            skipped.push(scene.id);
          } else if (args.transitionIn.type === "none") {
            scene.transitionIn = undefined;
          } else {
            scene.transitionIn = {
              type: args.transitionIn.type,
              direction: args.transitionIn.direction ?? "from-right",
              durationInFrames: args.transitionIn.durationInFrames ?? 15,
            };
          }
        }
        if (args.backgroundColor) scene.backgroundColor = args.backgroundColor;
        if (typeof args.durationInFrames === "number" && args.durationInFrames > 0) {
          scene.durationInFrames = args.durationInFrames;
        }
        if (args.namePrefix) scene.name = args.namePrefix + scene.name;
        if (args.nameSuffix) scene.name = scene.name + args.nameSuffix;
        updated.push(scene.id);
      });
      return draft;
    });
    return {
      success: true,
      sceneCount: updated.length,
      skippedTransitionCount: skipped.length,
      updatedSceneIds: updated,
    };
  },

  // ─── find_sound_effect definition (toolDefinitions array) lives in the big
  //     const above; the implementation is registered here:
  async search_free_music(args: { query: string; limit?: number }) {
    const tracks = await searchFreeMusic(args.query, args.limit ?? 5);
    return { tracks };
  },

  async find_sound_effect(args: { query: string; maxDuration?: number; limit?: number }) {
    const sounds = await searchSoundEffects(args.query, args.limit ?? 6, {
      maxDuration: args.maxDuration,
    });
    return { sounds };
  },

  async set_orientation(args: any) {
    return setOrientationImpl(args);
  },
  async reorder_scenes(args: any) {
    return reorderScenesImpl(args);
  },
  async move_scene(args: any) {
    return moveSceneImpl(args);
  },
  async set_all_transitions(args: any) {
    return setAllTransitionsImpl(args);
  },
  async animate_scene(args: any) {
    return animateSceneImpl(args);
  },
  async edit_by_mention(args: any) {
    return editByMentionImpl(args);
  },
  async duplicate_element(args: any) {
    return duplicateElementImpl(args);
  },
  async nudge_element(args: any) {
    return nudgeElementImpl(args);
  },
  async timeline_overview(args: any = {}) {
    return timelineOverviewImpl(args);
  },
  async fit_text_to_box(args: any) {
    return fitTextToBoxImpl(args);
  },
  async preview_single_scene(args: any) {
    return previewSingleSceneImpl(args);
  },

  async diagnose_scene(args: any) {
    return await diagnoseSceneImpl(args);
  },

  async audit_scene(args: any) {
    return await auditSceneImpl(args);
  },
  async set_animation_timing(args: any) {
    return setAnimationTimingImpl(args);
  },
  async add_line(args: any) {
    return addLineImpl(args);
  },
  async add_border(args: any) {
    return addBorderImpl(args);
  },
  async edit_duration(args: any) {
    return editDurationImpl(args);
  },
  async edit_timing(args: any) {
    return editTimingImpl(args);
  },
  async apply_template(args: any) {
    return applyTemplateImpl(args);
  },
  async save_scene_as_template(args: any) {
    return saveSceneAsTemplateImpl(args);
  },
  async list_templates(args: any = {}) {
    return listTemplatesImpl(args);
  },
  async delete_template(args: any) {
    return deleteTemplateImpl(args);
  },
  async suggest_templates(args: any = {}) {
    return suggestTemplatesImpl(args);
  },
};

async function addElementToScene(
  sceneId: string,
  element: TextElement | ImageElement | VideoElement | ShapeElement | CustomElement | AudioElement,
) {
  await sceneStore.update((draft) => {
    const scene = findScene(draft.scenes, sceneId);
    scene.elements.push(element);
    return draft;
  });
}
