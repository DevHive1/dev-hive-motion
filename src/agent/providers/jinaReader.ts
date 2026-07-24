/**
 * Jina.ai Reader — converts ANY URL (including JS-rendered SPAs, React apps,
 * Next.js sites, and paywalled articles) into clean Markdown text.
 *
 * Free, no API key required at low volume.
 * Docs: https://jina.ai/reader/
 */

const JINA_BASE = "https://r.jina.ai/";
const MAX_CHARS = 12_000;

export interface JinaReaderResult {
  url: string;
  content: string;
  truncated: boolean;
}

export async function jinaReadUrl(url: string): Promise<JinaReaderResult> {
  const jinaUrl = `${JINA_BASE}${url}`;

  const res = await fetch(jinaUrl, {
    headers: {
      // Ask for raw markdown back (default), no extra wrapper
      Accept: "text/plain",
      "X-No-Cache": "true",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Jina Reader failed for ${url}: HTTP ${res.status}`);
  }

  const raw = await res.text();
  const truncated = raw.length > MAX_CHARS;
  const content = truncated ? raw.slice(0, MAX_CHARS) + "\n\n[...content truncated]" : raw;

  return { url, content, truncated };
}
