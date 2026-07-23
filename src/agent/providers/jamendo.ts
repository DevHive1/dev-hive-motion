export interface MusicTrack {
  id: string;
  name: string;
  artist: string;
  durationSeconds: number;
  url: string; // Direct mp3 URL — usable as audio src
  tags: string[];
  licenseUrl: string;
}

const JAMENDO_BASE = "https://api.jamendo.com/v3.0";

/**
 * Search for free, Creative Commons–licensed background music from Jamendo.
 * Requires JAMENDO_CLIENT_ID in the environment (free registration at
 * https://devportal.jamendo.com). Returns direct MP3 URLs ready for
 * add_audio_element.
 */
export async function searchFreeMusic(query: string, limit = 5): Promise<MusicTrack[]> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "JAMENDO_CLIENT_ID is not configured. " +
        "Get a free API key at https://devportal.jamendo.com and add " +
        "JAMENDO_CLIENT_ID=your_key to your .env file. " +
        "Everything else still works without it.",
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(Math.min(limit, 10)),
    audioformat: "mp32",
    include: "musicinfo",
    namesearch: query,
    boost: "popularity_month",
  });

  const res = await fetch(`${JAMENDO_BASE}/tracks/?${params}`);
  if (!res.ok) {
    throw new Error(`Jamendo API error: HTTP ${res.status} — ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      name: string;
      artist_name: string;
      duration: number;
      audio: string;
      license_ccurl: string;
      musicinfo?: { tags?: { genres?: string[] } };
    }>;
    error?: string;
  };

  if (data.error) throw new Error(`Jamendo error: ${data.error}`);

  return (data.results ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artist_name,
    durationSeconds: t.duration,
    url: t.audio,
    tags: t.musicinfo?.tags?.genres ?? [],
    licenseUrl: t.license_ccurl ?? "https://creativecommons.org",
  }));
}
