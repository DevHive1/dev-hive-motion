export interface WikipediaSummary {
  title: string;
  extract: string;
  thumbnailUrl?: string;
  pageUrl: string;
}

/**
 * Wikipedia's REST summary endpoint - free, no key, no signup. Works for
 * any language Wikipedia (pass e.g. "ar" for Arabic, "en" for English).
 * Good for solid factual grounding on well-known topics (history, places,
 * people) - much more reliable for that than a general web search.
 */
export async function wikipediaLookup(
  title: string,
  language = "en",
): Promise<WikipediaSummary> {
  const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "remotion-agent-studio/1.0 (personal project)" },
  });

  if (!res.ok) {
    throw new Error(
      `Wikipedia lookup failed for "${title}" (${language}): ${res.status} ${res.statusText}. Try a different title or check spelling.`,
    );
  }

  const data = await res.json();

  return {
    title: data.title,
    extract: data.extract,
    thumbnailUrl: data.thumbnail?.source,
    pageUrl: data.content_urls?.desktop?.page ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}
