import * as cheerio from "cheerio";

export interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * DuckDuckGo doesn't offer a free general-purpose search API (their public
 * "Instant Answer" API only returns infobox-style answers, not ranked web
 * results). This uses their HTML endpoint instead - the same page a browser
 * with JS disabled would get - and parses the result list out of it. No API
 * key, no signup, no rate-limit tier to think about.
 */
export async function duckDuckGoSearch(
  query: string,
  maxResults = 6,
): Promise<DuckDuckGoResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // A real UA avoids being served a stripped-down bot response.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo search failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const results: DuckDuckGoResult[] = [];

  $(".result").each((_, el) => {
    if (results.length >= maxResults) return;

    const titleEl = $(el).find(".result__title a.result__a").first();
    const title = titleEl.text().trim();
    let url = titleEl.attr("href") ?? "";
    const snippet = $(el).find(".result__snippet").first().text().trim();

    // DuckDuckGo's HTML results wrap the real URL in a redirect link
    // (/l/?uddg=<encoded-url>&...) - unwrap it so callers get the real link.
    if (url.startsWith("//duckduckgo.com/l/") || url.startsWith("/l/")) {
      try {
        const redirectUrl = new URL(url.startsWith("//") ? `https:${url}` : `https://duckduckgo.com${url}`);
        const real = redirectUrl.searchParams.get("uddg");
        if (real) url = decodeURIComponent(real);
      } catch {
        // keep the raw href if parsing fails
      }
    }

    if (title && url) {
      results.push({ title, url, snippet });
    }
  });

  return results;
}
