import { nanoid } from "nanoid";
import { promises as fs } from "fs";
import path from "path";
// `msedge-tts` is published as CommonJS but exposes named exports the static
// analyser in Node 24 / modern TS picks up directly, so this ESM import works.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
const SERVER_PORT = Number(process.env.PORT ?? 4000);

export interface GeneratedVoiceover {
  url: string;
}

// Same names the agent / Pollinations code already used, mapped to the
// closest-matching Microsoft neural voice. Keeps existing prompts and any
// already-saved scene files that reference these names working unchanged.
const VOICE_MAP: Record<string, string> = {
  alloy: "en-US-AriaNeural",
  echo: "en-US-JennyNeural",
  fable: "en-GB-SoniaNeural",
  onyx: "en-US-DavisNeural",
  nova: "en-US-MichelleNeural",
  shimmer: "en-US-MonicaNeural",
};

// Fallback voices for different languages if the voice requested isn't available or appropriate.
const LANGUAGE_FALLBACKS: Record<string, string> = {
  "ar": "ar-EG-SalmaNeural", // Arabic (Egypt)
  "en": "en-US-MichelleNeural",
};

const VALID_VOICES = Object.keys(VOICE_MAP) as Array<
  keyof typeof VOICE_MAP
>;
export type EdgeTtsVoice = (typeof VALID_VOICES)[number];

// Create a fresh client for every request to avoid 'voiceLocale' undefined errors 
// caused by stale WebSocket connections in the msedge-tts library.
async function getClient(voiceName: string): Promise<MsEdgeTTS> {
  const client = new MsEdgeTTS();
  await client.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  return client;
}

/**
 * Text-to-speech narration via Microsoft Edge's free "Read Aloud" endpoint.
 * Same `generateVoiceover(text, voice)` signature as the Pollinations
 * provider, same on-disk shape (`public/audio/{nanoid}.mp3`), same local
 * URL back to the caller - so swapping the import in tools.ts is the only
 * change agents and scenes notice.
 *
 * Why this instead of Pollinations:
 *   - Completely free, no API key, no sign-up
 *   - No per-account pollen budget, no 402 when the balance is empty
 *   - Edge's neural voices are at the same quality tier as Azure's paid TTS
 *   - The endpoint is the public one Edge uses for its own Read Aloud
 *     feature, so it's stable and well-provisioned
 *
 * Cost: a single WebSocket per server process (see getClient). Cold start
 * is ~1s of WebSocket handshake; subsequent calls just stream the audio.
 */
export async function generateVoiceover(
  text: string,
  voice: EdgeTtsVoice = "nova",
): Promise<GeneratedVoiceover> {
  if (!text.trim()) {
    throw new Error("generateVoiceover: text is empty");
  }

  // Detect language for Arabic support
  const isArabic = /[\u0600-\u06FF]/.test(text);
  let voiceName = VOICE_MAP[voice] ?? VOICE_MAP.nova;

  if (isArabic) {
    // Use Arabic-specific neural voice for Arabic text, 
    // regardless of the requested English voice name.
    voiceName = LANGUAGE_FALLBACKS["ar"];
  }

  const client = await getClient(voiceName);

  // `toStream` returns a node Readable that emits raw MP3 frames
  // (no ID3 header, but still a valid MP3 that Chromium plays fine).
  const { audioStream } = client.toStream(text);


  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (c: Buffer | string) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    audioStream.on("end", () => resolve());
    audioStream.on("close", () => resolve());
    audioStream.on("error", reject);
  });

  if (chunks.length === 0) {
    throw new Error(
      "Edge TTS returned an empty audio stream - the service may be temporarily unavailable. Retry, or check https://www.microsoft.com/en-us/edge.",
    );
  }

  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const fileName = `${nanoid(10)}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);
  await fs.writeFile(filePath, Buffer.concat(chunks));

  return {
    url: `http://localhost:${SERVER_PORT}/audio/${fileName}`,
  };
}
