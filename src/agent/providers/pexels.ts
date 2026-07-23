const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

export interface StockPhoto {
  id: number;
  photographer: string;
  width: number;
  height: number;
  /** Direct, hotlink-safe image URL - use this as an image element's src. */
  src: string;
  pageUrl: string;
}

export interface StockVideo {
  id: number;
  width: number;
  height: number;
  durationSeconds: number;
  /** Direct, hotlink-safe video file URL - use this as a video element's src. */
  src: string;
  thumbnail: string;
  pageUrl: string;
}

function requireApiKey(): string {
  if (!PEXELS_API_KEY) {
    throw new Error(
      "PEXELS_API_KEY is not set. Get a free key at https://www.pexels.com/api/ and add it to .env, or these tools will keep failing.",
    );
  }
  return PEXELS_API_KEY;
}

async function pexelsGet(url: string): Promise<any> {
  const key = requireApiKey();
  // Pexels' own docs are explicit: pass the raw key, no "Bearer" prefix.
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    throw new Error(`Pexels request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function searchStockPhotos(
  query: string,
  perPage = 6,
  orientation?: "landscape" | "portrait" | "square",
): Promise<StockPhoto[]> {
  const params = new URLSearchParams({ query, per_page: String(perPage) });
  if (orientation) params.set("orientation", orientation);

  const data = await pexelsGet(`https://api.pexels.com/v1/search?${params.toString()}`);

  return (data.photos ?? []).map((p: any) => ({
    id: p.id,
    photographer: p.photographer,
    width: p.width,
    height: p.height,
    src: p.src?.large2x ?? p.src?.large ?? p.src?.original,
    pageUrl: p.url,
  }));
}

export async function searchStockVideos(
  query: string,
  perPage = 4,
  orientation?: "landscape" | "portrait" | "square",
): Promise<StockVideo[]> {
  const params = new URLSearchParams({ query, per_page: String(perPage) });
  if (orientation) params.set("orientation", orientation);

  const data = await pexelsGet(`https://api.pexels.com/videos/search?${params.toString()}`);

  return (data.videos ?? []).map((v: any) => {
    const files = [...(v.video_files ?? [])].sort(
      (a: any, b: any) => (b.width ?? 0) - (a.width ?? 0),
    );
    // Prefer a file that isn't absurdly large for a preview-weight fetch,
    // but still HD - middle of the sorted-by-width list is a reasonable
    // default; fall back to the largest available.
    const chosen = files.find((f: any) => (f.width ?? 0) <= 1920) ?? files[0];
    return {
      id: v.id,
      width: v.width,
      height: v.height,
      durationSeconds: v.duration,
      src: chosen?.link,
      thumbnail: v.image,
      pageUrl: v.url,
    };
  });
}
