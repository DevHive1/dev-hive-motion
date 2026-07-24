import { nanoid } from "nanoid";
import { sceneStore } from "../server/sceneStore";
import type {
  Animation,
  ImageElement,
  Scene,
  ShapeElement,
  TextElement,
  VideoElement,
  CustomElement,
  AudioElement,
  Composition,
  SceneElement,
  Transition,
  Storyboard,
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
import { computeLayoutFlags, type LayoutBox } from "./layoutCheck";
import { setOrientationDef, setOrientationImpl } from "./tools/orientation";
import { reorderScenesDef, reorderScenesImpl } from "./tools/scene/reorder";
import { setAllTransitionsDef, setAllTransitionsImpl } from "./tools/scene/transitions";
import { animateSceneDef, animateSceneImpl } from "./tools/animation/batch";
import { editByMentionDef, editByMentionImpl } from "./tools/element/mention";

/** Ollama/OpenAI-style tool definitions. Sent to the model on every turn. */
export const toolDefinitions = [
  setOrientationDef,
  reorderScenesDef,
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
      description: "Add an image element to a scene.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          src: { type: "string", description: "URL or local public/ path" },
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
        "Write the project's storyboard/plan BEFORE building anything - concept, narrative arc, mood direction, and a detailed scene-by-scene breakdown. Do this first for any real request ('a video about X', 'a promo for Y') so the build has a coherent, information-rich plan behind it instead of a couple of generic caption scenes. Research the topic first (web_search/wikipedia_lookup) so contentNotes has real facts, not placeholders. The user can view and download this plan. Overwrites any existing storyboard.",
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
      description:
        "Work out and VALIDATE precise element positions/timing for a scene BEFORE building it - the fix for elements landing in the wrong place or outside the frame. Describe each element's role and either give it exact x/y, or position it relative to an earlier element in the same call (e.g. 'below the heading') and this computes the exact x/y for you - no coordinate math, no guessing. Returns the fully-resolved layout plus any flags (overlaps, out-of-bounds, nothing visible at frame 0) BEFORE anything is built. Use the resolved x/y/width/height/zIndex/startFrame values exactly as returned when you call build_scene/add_*_element/add_animation right after. For any scene with more than one or two elements, or any text sitting near/on a shape or image, do this before building rather than positioning elements by feel.",
      parameters: {
        type: "object",
        properties: {
          elements: {
            type: "array",
            description: "In the order you want them resolved - an element can only be positioned relative to one that appears EARLIER in this array.",
            items: {
              type: "object",
              properties: {
                role: { type: "string", description: "A short label you'll reference from later elements and when building, e.g. 'heading', 'subtitle', 'backgroundPanel'." },
                type: { type: "string", enum: ["text", "image", "video", "shape", "custom", "audio"] },
                width: { type: "number", description: "Percent of canvas width (0-100)." },
                height: { type: "number", description: "Percent of canvas height (0-100)." },
                x: { type: "number", description: "Percent of canvas width from the left. Omit if using relativeTo instead." },
                y: { type: "number", description: "Percent of canvas height from the top. Omit if using relativeTo instead." },
                relativeTo: { type: "string", description: "The 'role' of an EARLIER element in this same array to position against, instead of giving x/y directly." },
                relation: {
                  type: "string",
                  enum: ["below", "above", "leftOf", "rightOf", "sameSpot"],
                  description: "How this element relates to relativeTo. 'sameSpot' means same x/y (e.g. a text label centered on a shape) - give it a higher zIndex than what it sits on.",
                },
                gap: { type: "number", description: "Percent-of-canvas gap between this element and relativeTo. Default 2. Ignored for 'sameSpot'." },
                zIndex: { type: "number", description: "Higher draws on top. Defaults to this element's position in the array (later = higher) if omitted." },
                startFrame: { type: "number", description: "Default 0." },
                durationInFrames: { type: "number" },
              },
              required: ["role", "type", "width", "height"],
            },
          },
        },
        required: ["elements"],
      },
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
      name: "search_free_music",
      description:
        "Search for free, Creative Commons–licensed background music tracks (Jamendo) by genre or mood. Returns direct MP3 URLs ready to use with add_audio_element. Requires JAMENDO_CLIENT_ID in .env — if not configured, this tool errors with clear instructions. Good queries: 'cinematic epic', 'calm ambient', 'upbeat corporate', 'lo-fi study', 'dramatic orchestral'.",
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
    await sceneStore.update((draft) => {
      const scene = findScene(draft.scenes, args.sceneId);
      const idx = scene.elements.findIndex((e) => e.id === args.elementId);
      if (idx === -1) throw new Error(`No element with id "${args.elementId}" in scene "${args.sceneId}".`);
      scene.elements[idx] = { ...scene.elements[idx], ...args.patch } as typeof scene.elements[number];
      return draft;
    });
    return { ok: true };
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

    return { sceneId };
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
    scenes: Array<{
      name: string;
      purpose: string;
      narrativeBeat?: string;
      contentNotes?: string;
      keyElements: string;
      transitionNote?: string;
      animationNote?: string;
    }>;
  }) {
    const storyboard: Storyboard = {
      title: args.title,
      concept: args.concept,
      narrativeArc: args.narrativeArc ?? "",
      moodDirection: args.moodDirection,
      scenes: args.scenes.map((s) => ({
        name: s.name,
        purpose: s.purpose,
        narrativeBeat: s.narrativeBeat ?? "",
        contentNotes: s.contentNotes ?? "",
        keyElements: s.keyElements,
        transitionNote: s.transitionNote ?? "",
        animationNote: s.animationNote ?? "",
      })),
    };
    await sceneStore.update((draft) => {
      draft.storyboard = storyboard;
      return draft;
    });
    return { ok: true };
  },

  async review_scene(args: { sceneId: string }) {
    const composition = sceneStore.get();
    const scene = findScene(composition.scenes, args.sceneId);

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

    return { elements, flags };
  },

  async plan_scene_layout(args: {
    elements: Array<{
      role: string;
      type: "text" | "image" | "video" | "shape" | "custom" | "audio";
      width: number;
      height: number;
      x?: number;
      y?: number;
      relativeTo?: string;
      relation?: "below" | "above" | "leftOf" | "rightOf" | "sameSpot";
      gap?: number;
      zIndex?: number;
      startFrame?: number;
      durationInFrames?: number;
    }>;
  }) {
    const VALID_TYPES = new Set(["text", "image", "video", "shape", "custom", "audio"]);

    const resolvedByRole = new Map<string, { x: number; y: number; width: number; height: number }>();
    const resolvedElements: Array<{
      role: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      zIndex: number;
      startFrame: number;
      durationInFrames: number | undefined;
    }> = [];

    args.elements.forEach((spec, index) => {
      if (!VALID_TYPES.has(spec.type)) {
        throw new Error(
          `Element "${spec.role}" has an invalid type "${spec.type}" - must be exactly one of text, image, video, shape, custom, audio (no extra words).`,
        );
      }

      let x = spec.x;
      let y = spec.y;

      if (spec.relativeTo) {
        const ref = resolvedByRole.get(spec.relativeTo);
        if (!ref) {
          throw new Error(
            `relativeTo "${spec.relativeTo}" (for element "${spec.role}") must be the role of an EARLIER element in this same call. Roles resolved so far: ${[...resolvedByRole.keys()].join(", ") || "(none)"}.`,
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
            y = ref.y - spec.height - gap;
            break;
          case "leftOf":
            x = ref.x - spec.width - gap;
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
        }
      }

      if (x === undefined || y === undefined) {
        throw new Error(`Element "${spec.role}" needs either x/y or relativeTo+relation.`);
      }

      // Content that must actually be seen (text/image/video/custom) gets a
      // hard rejection, not just a warning, if it's genuinely off-canvas -
      // a soft flag can be (and in practice has been) ignored. Shapes are
      // exempt: a blurred glow circle bleeding off the edge is a normal,
      // deliberate technique, not a mistake.
      if (spec.type !== "shape" && spec.type !== "audio") {
        const overRight = x + spec.width - 100;
        const overBottom = y + spec.height - 100;
        if (x < -5 || y < -5 || overRight > 5 || overBottom > 5) {
          throw new Error(
            `Element "${spec.role}" (${spec.type}) resolves to x:${Math.round(x * 10) / 10}, y:${Math.round(y * 10) / 10}, width:${spec.width}, height:${spec.height} - that puts it mostly or entirely off-canvas. Content elements must stay within the 0-100 range (x + width <= 100, y + height <= 100). Adjust the position/size and call plan_scene_layout again.`,
          );
        }
      }

      resolvedByRole.set(spec.role, { x, y, width: spec.width, height: spec.height });
      resolvedElements.push({
        role: spec.role,
        type: spec.type,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        width: spec.width,
        height: spec.height,
        zIndex: spec.zIndex ?? index,
        startFrame: spec.startFrame ?? 0,
        durationInFrames: spec.durationInFrames,
      });
    });

    const boxes: LayoutBox[] = resolvedElements
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

    return { resolvedElements, flags };
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
  async set_all_transitions(args: any) {
    return setAllTransitionsImpl(args);
  },
  async animate_scene(args: any) {
    return animateSceneImpl(args);
  },
  async edit_by_mention(args: any) {
    return editByMentionImpl(args);
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
