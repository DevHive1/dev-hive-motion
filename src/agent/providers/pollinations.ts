import { nanoid } from "nanoid";
import { promises as fs } from "fs";
import path from "path";

const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY;

/**
 * Pollinations accepts the key two ways:
 *   - `?key=...` query param  (intended for browser flows that can't set headers)
 *   - `Authorization: Bearer ...` header  (preferred for server-to-server)
 *
 * We use the header for *generation* so the secret never ends up baked into
 * a URL we then store in composition.json or hand to <Audio src=...>.
 */
function pollinationsHeaders(): Record<string, string> {
  if (!POLLINATIONS_API_KEY) return {};
  return { Authorization: `Bearer ${POLLINATIONS_API_KEY}` };
}

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
const IMAGES_DIR = path.join(PUBLIC_DIR, "images");
const SERVER_PORT = Number(process.env.PORT ?? 4000);

/**
 * Where generated media gets served from. Vite picks up `public/` at the
 * root automatically for the editor; src/server/index.ts also serves it
 * so the Remotion renderer (which talks to the API server, not Vite) can
 * fetch the files during render.
 */
function publicUrl(relativePath: string): string {
  return `http://localhost:${SERVER_PORT}/${relativePath}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function extensionFromContentType(contentType: string | null, fallback: string): string {
  if (!contentType) return fallback;
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return fallback;
}

export interface GeneratedImage {
  url: string;
}

/**
 * AI image generation for things a stock photo library won't have -
 * specific illustrations, abstract concepts, a particular creative
 * direction. Downloads the image locally to `public/images/{id}.{ext}`
 * and returns a URL our own server serves - so the composition has no
 * external hotlink dependency, and the API key never appears in any
 * saved URL. Works without a key at low volume; POLLINATIONS_API_KEY
 * removes rate limits and unlocks higher concurrency.
 */
export async function generateImage(
  prompt: string,
  width = 1920,
  height = 1080,
): Promise<GeneratedImage> {
  const apiUrl =
    `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&nologo=true`;

  const res = await fetch(apiUrl, { headers: pollinationsHeaders() });
  if (!res.ok) {
    throw new Error(
      `Pollinations image generation failed: ${res.status} ${res.statusText}. ` +
        `Check POLLINATIONS_API_KEY in .env (https://enter.pollinations.ai) - ` +
        `402 usually means the key authenticated but the account balance is empty.`,
    );
  }

  await ensureDir(IMAGES_DIR);
  const ext = extensionFromContentType(res.headers.get("content-type"), "jpg");
  const fileName = `${nanoid(10)}.${ext}`;
  const filePath = path.join(IMAGES_DIR, fileName);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return { url: publicUrl(`images/${fileName}`) };
}

export interface GeneratedVoiceover {
  url: string;
}

const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type PollinationsVoice = (typeof VALID_VOICES)[number];

/**
 * Text-to-speech narration. Downloads the audio to `public/audio/{id}.mp3`
 * and returns a local URL - same reason as generateImage: no key in saved
 * URLs, no hotlink dependency at render time, and the file keeps working
 * even if the Pollinations account runs out of pollen later.
 *
 * 402 from this endpoint means the key authenticated but the account or
 * per-key budget is exhausted (per Pollinations docs). Unlike image
 * generation, the audio path can be tightly rate-limited without a key,
 * so POLLINATIONS_API_KEY is effectively required for any real use.
 */
export async function generateVoiceover(
  text: string,
  voice: PollinationsVoice = "nova",
): Promise<GeneratedVoiceover> {
  if (!POLLINATIONS_API_KEY) {
    throw new Error(
      `Pollinations voiceover generation needs POLLINATIONS_API_KEY in .env ` +
        `(get one free at https://enter.pollinations.ai).`,
    );
  }

  const apiUrl =
    `https://gen.pollinations.ai/audio/${encodeURIComponent(text)}` +
    `?voice=${voice}`;

  const res = await fetch(apiUrl, { headers: pollinationsHeaders() });
  if (!res.ok) {
    const detail = `${res.status} ${res.statusText}`;
    let hint: string;
    if (res.status === 402) {
      hint =
        `The key authenticated but the account or per-key budget is empty - ` +
        `top up pollen at https://enter.pollinations.ai.`;
    } else if (res.status === 401) {
      hint = `The key is missing or invalid - reissue it at https://enter.pollinations.ai.`;
    } else {
      hint = `Set POLLINATIONS_API_KEY in .env (https://enter.pollinations.ai) and retry.`;
    }
    throw new Error(`Pollinations voiceover generation failed: ${detail}. ${hint}`);
  }

  await ensureDir(AUDIO_DIR);
  const ext = extensionFromContentType(res.headers.get("content-type"), "mp3");
  const fileName = `${nanoid(10)}.${ext}`;
  const filePath = path.join(AUDIO_DIR, fileName);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return { url: publicUrl(`audio/${fileName}`) };
}
