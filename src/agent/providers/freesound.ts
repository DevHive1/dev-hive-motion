/**
 * Freesound.org — search for Creative Commons sound effects.
 * Free API key at https://freesound.org/apiv2/apply/
 * Set FREESOUND_API_KEY in .env.
 *
 * Returns direct preview MP3 URLs ready for add_audio_element.
 */

const FREESOUND_BASE = "https://freesound.org/apiv2";

export interface SoundEffect {
  id: number;
  name: string;
  tags: string[];
  duration: number;
  /** High-quality preview MP3 URL (direct link, no auth needed for previews) */
  previewUrl: string;
  license: string;
  username: string;
  description: string;
}

export async function searchSoundEffects(
  query: string,
  limit = 6,
  filter?: { maxDuration?: number; minDuration?: number },
): Promise<SoundEffect[]> {
  const apiKey = process.env.FREESOUND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FREESOUND_API_KEY is not configured. " +
        "Get a free API key at https://freesound.org/apiv2/apply/ " +
        "(takes ~2 min, free account) and add FREESOUND_API_KEY=your_key to .env. " +
        "Everything else still works without it.",
    );
  }

  const filterParts: string[] = ["type:wav OR type:mp3", "is_explicit:false"];
  if (filter?.maxDuration) filterParts.push(`duration:[0 TO ${filter.maxDuration}]`);
  if (filter?.minDuration) filterParts.push(`duration:[${filter.minDuration} TO *]`);

  const params = new URLSearchParams({
    token: apiKey,
    query,
    fields: "id,name,tags,duration,previews,license,username,description",
    filter: filterParts.join(" "),
    sort: "score",
    page_size: String(Math.min(limit, 15)),
  });

  const res = await fetch(`${FREESOUND_BASE}/search/text/?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(
      `Freesound API error: HTTP ${res.status} — ${await res.text().catch(() => "")}`,
    );
  }

  const data = (await res.json()) as {
    results?: Array<{
      id: number;
      name: string;
      tags: string[];
      duration: number;
      previews: { "preview-hq-mp3": string; "preview-lq-mp3": string };
      license: string;
      username: string;
      description: string;
    }>;
    error?: string;
  };

  if (data.error) throw new Error(`Freesound error: ${data.error}`);

  return (data.results ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    tags: s.tags?.slice(0, 8) ?? [],
    duration: s.duration,
    previewUrl: s.previews?.["preview-hq-mp3"] ?? s.previews?.["preview-lq-mp3"],
    license: s.license,
    username: s.username,
    description: (s.description ?? "").slice(0, 200),
  }));
}
