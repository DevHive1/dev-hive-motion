export interface UrlCheckResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  error?: string;
}

export async function checkUrl(url: string): Promise<UrlCheckResult> {
  try {
    // HEAD is cheap, but some CDNs (including a few image/video hosts)
    // don't implement it properly - fall back to a ranged GET so we don't
    // download the whole file just to check it exists.
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      return {
        ok: true,
        status: head.status,
        contentType: head.headers.get("content-type") ?? undefined,
      };
    }

    const ranged = await fetch(url, { headers: { Range: "bytes=0-1023" } });
    return {
      ok: ranged.ok,
      status: ranged.status,
      contentType: ranged.headers.get("content-type") ?? undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
