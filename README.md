# Remotion Agent Studio

An AI agent (running on Ollama) builds and edits videos by manipulating a
JSON scene graph. A live browser editor shows the result instantly and lets
you take manual control of any element. Final export renders remotely
(Remotion Lambda), not on this machine.

## How it fits together

```
                     ┌─────────────────────┐
  你 prompt  ───────▶│   Agent loop         │  Ollama (qwen2.5-coder etc.)
                     │   (src/agent/*)      │  think → call tools → observe
                     └──────────┬───────────┘
                                │ tool calls mutate
                                ▼
                     ┌─────────────────────┐
                     │   Scene store        │  data/composition.json
                     │ (src/server/*)       │  single source of truth
                     └──────────┬───────────┘
                    SSE push    │    ▲ manual edits (PUT)
                                ▼    │
                     ┌─────────────────────┐
                     │   Editor UI           │  @remotion/player live preview
                     │ (src/editor/*)        │  timeline + per-element panel
                     └─────────────────────┘

                     ┌─────────────────────┐
                     │   Renderer            │  scene graph JSON → actual
                     │ (src/remotion/*)      │  Remotion <Sequence>/elements
                     └──────────┬───────────┘
                                │ same component, two uses:
                    live preview│         final export
                    (Player)    ▼         (Remotion Studio / Lambda)
```

The key decision: **the agent never writes TSX.** It only calls tools
(`add_text_element`, `add_animation`, `update_element`, ...) that mutate a
validated JSON tree (`src/schema/scene.ts`). The same JSON drives the live
preview, the property panel, and the final render — so nothing can get out
of sync, and the agent can't produce broken code.

Three things worth knowing about how this actually works:

- **Position and size are percent of canvas (0-100), not pixels.** x, y,
  width, height on every element mean "percent from the left/top" and
  "percent of canvas width/height" - x:20 is 20% from the left on any
  resolution, without the agent needing to know or compute actual pixel
  values. This is deliberate: asking a model to place things correctly in
  raw pixels against a 1920x1080 (or 1080x1920, or anything else) canvas is
  exactly the kind of arithmetic small/free models get wrong, producing
  elements that are the wrong size or land outside the frame. Percent makes
  that class of mistake much harder to make. The static position/size is
  applied as CSS `left/top/width/height` in `%` (which correctly resolves
  against the canvas-sized parent); only the animation-driven delta is
  applied via `transform: translate()` in `src/remotion/animate.ts` -
  converted from percent to pixels there using Remotion's `useVideoConfig()`,
  since CSS `%` inside `transform` is relative to the element itself, not
  the canvas. The static position and the animated delta are two completely
  separate style properties (`left`/`top` vs `transform`) specifically so
  they can never double up the way earlier revisions of this file did.
- **Scene-to-scene transitions are real transitions**, not just a hard cut.
  `src/remotion/Renderer.tsx` uses `@remotion/transitions`' `TransitionSeries`
  driven by each scene's `transitionIn` field (fade/slide/wipe), set via the
  agent's `set_scene_transition` tool. The system prompt
  (`src/agent/systemPrompt.ts`) treats motion and transitions as the default
  for any "video"/"motion graphics" request, not an optional extra — a
  scene with nothing animated is treated as an incomplete result.
- **A broken image/video URL shows a visible warning box**, not a silent
  blank frame - `ImageElement.tsx`/`VideoElement.tsx` catch the load error
  and render the failing URL directly in the preview instead of just empty
  space, so a bad link (an invented one, a dead redirect, whatever) is
  obvious immediately instead of looking like a positioning bug.

## Project layout

- `src/schema/scene.ts` — zod schema for the whole video (composition → scenes → elements → animations, plus transitions/gradients/typography extras). This is the contract everything else follows.
- `src/remotion/` — turns scene-graph JSON into an actual Remotion composition (`Renderer.tsx` + one component per element type), using `@remotion/transitions` for real scene-to-scene transitions.
- `src/agent/` — the Ollama tool-calling loop (`agentLoop.ts`, up to 40 steps per request), the tool definitions/implementations (`tools.ts`), the system prompt, and `providers/` (DuckDuckGo search, Pexels stock media, URL checking).
- `src/server/` — Express API: serves/updates the composition, streams live updates over SSE, exposes `GET /api/models` and `POST /api/agent/prompt`.
- `src/editor/` — the React editor (Vite): live preview (`Preview.tsx`), scene list (`Timeline.tsx`), per-element property panel (`ElementPanel.tsx`), model picker, and the chat panel that talks to the agent (`ChatPanel.tsx`).

## Tools available to the agent

The agent works in four phases now, not just "call tools until done" - see `src/agent/systemPrompt.ts`:

1. **Research + Plan** — `create_storyboard` writes a concept, a narrative arc, a specific mood direction, and a detailed scene-by-scene breakdown (each scene's `contentNotes` holds real facts from `web_search`/`wikipedia_lookup`, not placeholder text) *before* anything gets built. This is what the user sees and can download (Scenes tab → Storyboard card → Download plan). The mood direction is meant to actually vary per project - there's deliberately no fixed "house style" baked into the prompt, so a documentary about Egypt and a tech product launch shouldn't converge on the same look.
2. **Layout** — `plan_scene_layout` resolves and validates exact element positions *before* anything is built. Describe an element's role and either give it exact x/y or position it relative to an earlier element in the same call ("below the heading", "same spot as the panel but higher zIndex") - it computes the coordinates and runs the same overlap/bounds check `review_scene` does, so a layout mistake (text landing in the wrong place, an element pushed off-frame) gets caught before it's ever built, not after.
3. **Build** — scene/element tools, described below.
4. **Review** — `review_scene`, called after every scene, returns the same kind of precomputed report (element bounding boxes, layering overlaps, whether anything is visible at frame 0, out-of-bounds elements) for what actually got built, as a second check. `reorder_layer` is the fix for the most common flag (an element stacked in front of/behind where it should be). Both `plan_scene_layout` and `review_scene` share their bounds/overlap-checking logic (`src/agent/layoutCheck.ts`), so a plan that passes and a built scene that passes are checked identically.

**Scene structure** — `list_scenes`, `add_scene`, `update_scene`, `remove_scene`, `duplicate_scene`

**Fast path** — `build_scene` creates a whole scene (background, every element, animations, transition) in one call.

**Fine-grained editing** — `add_text_element`, `add_image_element`, `add_video_element`, `add_shape_element`, `add_custom_element` (raw HTML/CSS/JS - see "Custom HTML/CSS/JS per element" below - the prompt is explicit that this is for **one small component**, e.g. a single button, never a whole scene bundled into one blob, which was defeating the point of having a scene graph at all), `add_audio_element` (voiceover/music - see Audio below), `update_element`, `remove_element`, `add_animation`, `set_scene_transition` (fade, slide, wipe, flip, or clockWipe), `set_composition_meta`, `reorder_layer`

**Layout & Review** — `plan_scene_layout` (before building), `review_scene` (after building) - see above

**Research** — `web_search` (DuckDuckGo, free, no key), `wikipedia_lookup` (structured factual summaries - much more reliable than a general search for well-known historical/factual topics, which matters a lot for documentary-style content), `fetch_page_content` (reads the full text of a specific page when a search snippet isn't enough)

**Media** — `search_stock_images` / `search_stock_videos` (Pexels, needs a free `PEXELS_API_KEY`), `generate_ai_image` (Pollinations.ai, for things stock photos don't cover - illustrations, abstract concepts), `generate_voiceover` (Pollinations.ai TTS narration - pair with `add_audio_element`), `check_url` (verify any other URL before trusting it). The system prompt forbids inventing a media URL **and forbids falling back to a guessed one if a media tool errors** - it's told to build without that element and say what's not configured, not substitute something from memory. A broken link that does slip through shows as a visible warning box in the preview rather than blank space.

**Quality control** — `check_contrast` (WCAG contrast ratio between a text color and its background - catches unreadable combinations before they end up in a render)

**Production value primitives** — this is what the tools *can express*, separate from the workflow that decides how to use them:
- Shapes: `gradient`, `blurPx` (self-blur, ambient glow), `backdropBlurPx` (glassmorphism), `boxShadow`. Images: `boxShadow` too.
- Text: `letterSpacing`, `textShadow`, `highlightColor`, real `fontFamily`/`fontWeight` (see Fonts below).
- Audio: a dedicated element type (`AudioElementSchema`) using Remotion's `<Audio>` - not bolted onto video elements.

**Fonts** — `src/fontCatalog.ts` lists a curated set of real Google Fonts (Arabic: Cairo, Tajawal, Amiri, Reem Kufi, El Messiri; Latin: Inter, Space Grotesk, Playfair Display, JetBrains Mono, Bebas Neue), and `src/remotion/fonts.ts` loads them via `@remotion/google-fonts` at module scope - so they're available both in the live preview and in final render, which otherwise has no fonts beyond generic system ones. The system prompt only lets the agent pick `fontFamily` from this exact list. Add more by importing the font package (check `node_modules/@remotion/google-fonts/dist/esm/` for available names) in both `fontCatalog.ts` (name/description) and `fonts.ts` (the actual `loadFont()` call).

## Setup

```bash
npm install
cp .env.example .env   # point OLLAMA_HOST at wherever Ollama actually runs,
                        # and add PEXELS_API_KEY if you want stock media search
```

Pull a tool-calling-capable model if you haven't:

```bash
ollama pull qwen2.5-coder:7b
```

Run the agent server + editor together:

```bash
npm run dev
```

- Editor: http://localhost:5173
- API: http://localhost:4000

Type a prompt in the chat panel, e.g. *"add an intro scene with a bold
white headline that fades and slides in, then a second scene with a
colored rectangle background"* — watch the timeline and preview update
live, then click any element to fine-tune it by hand.

## Running this from Termux

The agent/editor part of this stack (Express server + Vite editor) runs
directly on Termux fine - `npm run dev` works on-device, no VPS needed just
to build/edit videos.

**Exporting a real video file is the one part that needs a real Chromium**,
because Remotion's own bundled "Chrome Headless Shell" has no Android build
at all - trying to render gives `Unsupported platform: android`. Two ways
to get real exports:

### Option A: point Remotion at a real Chromium on-device (experimental)

If you already have a working Chromium on Termux (e.g. via `termux-x11` +
the `chromium` package - the same setup you'd use to just browse the web
from Termux), you can point Remotion straight at it instead of running
anywhere else:

1. Find your binary: `which chromium-browser` (or whatever the package
   installed).
2. Set `CHROME_EXECUTABLE_PATH` in `.env` to that path.
3. Try a render. Remotion launches through `scripts/chromium-wrapper.sh`,
   which forwards to your real Chromium with the extra flags Remotion's
   typed `chromiumOptions` doesn't expose (`--disable-features=NetworkService,NetworkServiceSandbox`,
   on top of `--no-sandbox` which Remotion already passes by default);
   `chromiumOptions.gl` is set to `swiftshader` (software rendering, since
   GPU driver support is frequently missing/unreliable on Android) and
   `enableMultiProcessOnLinux: false` (matches `--single-process`).
4. This tries **headless mode first** (`CHROME_HEADLESS=true`, the
   default) - no `termux-x11`/display needed at all if your Chromium build
   supports it, which is the simpler and more robust path.
5. If headless doesn't work with your specific build, set
   `CHROME_HEADLESS=false` and make sure `termux-x11` is already running
   with `DISPLAY=:0` **exported in the same shell that runs `npm run dev`**
   (not just the shell you'd normally launch a browser from - the Node
   process needs the env var too). Something like:
   ```bash
   export DISPLAY=:0
   pgrep -f termux-x11 >/dev/null || termux-x11 :0 >/dev/null 2>&1 &
   sleep 2
   npm run dev
   ```

**Be honest with yourself about this path**: it depends on your specific
Chromium build/Android version/GPU driver combination, none of which can be
verified ahead of time from outside your device - it may just work, or it
may need flag tweaks in `scripts/chromium-wrapper.sh` for your setup. If it
doesn't pan out, Option B below always works.

### Option B: render somewhere else

- A small VPS running `npm run dev` (Hetzner/Contabo/DigitalOcean, a few
  $/month) - access the same editor from your phone's browser at
  `http://<server-ip>:5173`. Simple, full control, fixed monthly cost.
- **Remotion Lambda** - deploy once, every render happens on AWS
  regardless of what device clicked Export. Pay-per-render instead of a
  monthly server. See below.

## Exporting a real video (or GIF)

Click **Export** in the editor header, pick MP4 or GIF, and render. This
renders the current composition locally, right from the running server
(`src/server/render.ts`, using `@remotion/renderer` + `@remotion/bundler`),
and gives you a download link when it's done - no separate CLI step needed.
The first render of a session is slower (it bundles the project once and
caches that bundle for subsequent renders). GIFs are rendered at half scale
by default since a full-HD GIF gets huge fast.

Finished files are served from the Express server at `/renders/<file>` and
proxied through Vite's dev server (`vite.config.ts`) so the download link
works from the same origin the editor runs on. If you add another reverse
proxy/domain in front of this in a real deployment, make sure `/renders` is
routed the same way `/api` is - otherwise a download link resolves to
whatever fallback page your proxy serves for unmatched routes instead of
the actual file.

This *is* real local rendering (headless Chromium on whatever machine runs
`npm run dev`), which by default needs a real Linux/Mac/Windows Chrome
build - see "Running this from Termux" above for the Android-specific
situation and your two options there.

For rendering off of any single device entirely (so exports don't compete
with the agent/editor for resources, or so a low-power device can still
"render" a heavy project), use **Remotion Lambda** instead - deploy this
project to AWS once, then every render happens on AWS's machines:

```bash
npx remotion lambda functions deploy
npx remotion lambda sites create
npx remotion lambda render <site-url> MainComposition --props='{"composition": <your JSON>}'
```

See https://www.remotion.dev/docs/lambda for the one-time AWS account setup.
`npm run studio` (Remotion Studio) and `npm run render` (CLI, local file) are
also still there if you want them - all three paths use the exact same
`MainComposition`.

## Direct manipulation on the canvas

Select an element (Elements tab → click it), and a dashed box with corner
handles appears directly on the video preview - drag the box to move the
element, drag a corner to resize it. Works with touch on mobile, not just
mouse: it's built on Pointer Events (`src/editor/CanvasOverlay.tsx`), which
unify mouse/touch/pen into one code path. The overlay measures the actual
letterboxed video frame in JS (the same math as CSS `object-fit: contain`)
rather than assuming the preview box is pixel-exact, so it stays aligned
regardless of window size.

## The storyboard/plan

For any real request, the agent writes a plan first via `create_storyboard`
- a concept, a specific mood direction, and a scene-by-scene breakdown -
before building anything. It shows up as a card at the top of the Scenes
tab with a **Download plan** button (exports as Markdown, client-side, no
server round-trip). The mood direction is meant to be specific to each
project; there's no fixed visual template baked into the prompt, on purpose
- see `CREATIVE DIRECTION` in `src/agent/systemPrompt.ts`.

## Previewing one scene in isolation

Each scene in the Scenes tab has a **solo** toggle. Turn it on and the
preview shows only that scene, looped, instead of the whole timeline - useful
for fine-tuning one scene's animation timing without scrubbing through
everything before it. Toggle it off (or solo a different scene) to go back
to the full timeline.

## Custom HTML/CSS/JS/SVG per element

`add_custom_element` (and `build_scene`'s `"custom"` kind) renders arbitrary
markup in an isolated iframe (`src/remotion/elements/CustomElement.tsx`) -
for layouts or effects the built-in element types don't cover. **Inline SVG
is a first-class use of this tool** - custom icons, shapes, patterns, data
visualizations, hand-built graphics - just place `<svg>...</svg>` directly
in the `html` field; it renders exactly as reliably as plain HTML. Static
HTML/CSS/SVG renders reliably in both the live preview and a final export.
JS-driven or CSS transition/keyframe animation inside it plays fine in the
live preview (real browser playback) but **is not guaranteed to render
correctly frame-by-frame in a final export** - Remotion's frame-stepping
doesn't control timers running inside an iframe. Prefer `add_animation` on
a built-in element (SVG included) for anything that must be correct in the
exported file; reach for a custom element for static rich content.

**Editing existing custom code**: `edit_custom_element_code` makes a
targeted find-and-replace edit to an existing element's `html`/`css`/`js`
(the same `oldText` must appear exactly once, or it fails and says so -
same discipline as this codebase's own `str_replace` tool) instead of the
agent regenerating the whole thing from memory for a small change, which
risks silently losing or altering parts the user didn't ask about.

**One component per custom element, not a whole scene.** The system prompt
is explicit: a button, an icon, a specific effect - not "the whole scene as
one HTML blob with a background and three buttons in it." Building a whole
scene as one piece of HTML defeats the point of having a scene graph at
all - nothing in it can be individually selected, moved, or restyled
afterward. If this still happens, it's a prompt-following problem to point
out directly ("split that button out as its own element").

The iframe's `srcDoc` load is synced with Remotion's frame capture via
`delayRender()`/`continueRender()` (`CustomElement.tsx`) - without this, an
export could screenshot a frame before the iframe finished rendering its
content, showing it blank even though the live preview looked fine.

## What's intentionally left as a starting point

- **Auth/multi-user**: the server keeps one project (`data/composition.json`)
  and one chat history (`data/chatlog.json`, what the editor's chat panel
  shows and restores on refresh - a **Clear chat** button above the log
  wipes both this and the LLM's own context window via `DELETE
  /api/chatlog`, for a genuine fresh start). Fine for solo use; add
  per-project IDs before sharing it. The LLM's own raw context window
  (`conversationHistory` in `src/server/index.ts`) is otherwise
  in-memory-only and resets on server restart, separate from the persisted
  chat log the UI displays.
- **Animation editing UI**: you can add/adjust animations via the agent
  (`add_animation` tool) today; the element panel doesn't yet expose a
  keyframe editor — that's the natural next panel to build.
- **Undo/redo**: the scene store persists to `data/composition.json` on
  every change but doesn't keep a history stack yet.
- **Asset upload**: image/video `src` fields currently take URLs (including
  ones you find via `search_stock_images`/`search_stock_videos`); wiring up
  local file upload into a `public/` folder (or S3, since Lambda needs
  publicly reachable assets anyway) is the next thing worth adding.
- **Render queue**: `/api/render` handles one render at a time; a second
  request while one is in flight will queue behind Express's request
  handling rather than run concurrently - fine for solo use, worth a real
  queue if this becomes multi-user.
