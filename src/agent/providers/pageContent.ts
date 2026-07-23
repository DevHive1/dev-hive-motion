import * as cheerio from "cheerio";

export interface PageContent {
  title: string;
  text: string;
  truncated: boolean;
}

const MAX_CHARS = 8000;

/**
 * Reads a specific URL and extracts the readable text (strips nav/script/
 * style/footer noise). For going deeper than a search snippet - e.g. the
 * agent found a promising article via web_search and wants the actual
 * content, not just the two-line summary.
 */
export async function fetchPageContent(url: string): Promise<PageContent> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetching ${url} failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(`${url} is not an HTML page (content-type: ${contentType}) - can't extract text from it.`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  $("script, style, nav, footer, header, noscript, iframe, svg").remove();

  const title = $("title").first().text().trim();
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const truncated = text.length > MAX_CHARS;

  return {
    title,
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    truncated,
  };
}
