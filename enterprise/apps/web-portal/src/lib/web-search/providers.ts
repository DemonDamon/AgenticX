/**
 * Enterprise portal web search providers (TypeScript, independent of Desktop Python).
 */

import { directFetch } from "./direct-fetch";
import { resolveFreshness, type BochaFreshness } from "./freshness";

export const WEB_SEARCH_MAX_RESULTS_CAP = 50;
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_SNIPPET_CHARS = 600;

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** ISO8601，provider 提供时才有（当前仅 Bocha）。 */
  publishedAt?: string;
};

export type WebSearchProviderName = "duckduckgo" | "bocha" | "tavily";

export type WebSearchRuntimeConfig = {
  enabled: boolean;
  provider: WebSearchProviderName;
  apiKey: string;
  maxResults: number;
};

type FetchLike = typeof fetch;

function clampMaxResults(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(WEB_SEARCH_MAX_RESULTS_CAP, Math.floor(n)));
}

function truncateSnippet(text: string, maxChars = DEFAULT_SNIPPET_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function unwrapDuckDuckGoRedirect(href: string): string {
  if (!href.includes("uddg=")) return href;
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    // keep original
  }
  return href;
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const linkRe = /<a[^>]*class=['"][^'"]*result__a[^'"]*['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class=['"][^'"]*result__snippet[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = Array.from(html.matchAll(snippetRe)).map((m) => stripHtml(m[1] ?? ""));

  let snippetIdx = 0;
  for (const match of html.matchAll(linkRe)) {
    if (hits.length >= maxResults) break;
    const href = unwrapDuckDuckGoRedirect(match[1] ?? "");
    const title = stripHtml(match[2] ?? "");
    if (!href || !title) continue;
    hits.push({
      title,
      url: href,
      snippet: truncateSnippet(snippets[snippetIdx] ?? ""),
    });
    snippetIdx += 1;
  }
  return hits;
}

function hrefFromAnchorOpenTag(tagOpen: string): string {
  const m = /href=['"]([^'"]+)['"]/i.exec(tagOpen);
  return (m?.[1] ?? "").trim();
}

/** Aligned with Near `search_duckduckgo_lite` / `_DDG_LITE_*` parsers. */
export function parseDuckDuckGoLite(html: string, maxResults: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  // class 可能在 href 前或后（真实 Lite 页常见 href 在前）
  const linkRe = /(<a[^>]*class=['"]result-link['"][^>]*>)([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  const snippets = Array.from(html.matchAll(snippetRe)).map((m) => stripHtml(m[1] ?? ""));

  let snippetIdx = 0;
  for (const match of html.matchAll(linkRe)) {
    if (hits.length >= maxResults) break;
    let href = unwrapDuckDuckGoRedirect(hrefFromAnchorOpenTag(match[1] ?? ""));
    if (!href || href.startsWith("#")) continue;
    if (href.startsWith("//")) href = `https:${href}`;
    const title = stripHtml(match[2] ?? "");
    hits.push({
      title: title || href,
      url: href,
      snippet: truncateSnippet(snippets[snippetIdx] ?? ""),
    });
    snippetIdx += 1;
  }
  return hits;
}

/** Aligned with Near `_looks_like_ddg_challenge`. */
export function looksLikeDdgChallenge(statusCode: number, html: string): boolean {
  if (statusCode === 202) return true;
  const t = (html || "").toLowerCase();
  return (
    t.includes("anomaly.js") ||
    t.includes("automated requests") ||
    t.includes("unusual traffic") ||
    t.includes("challenge") ||
    t.includes("unfortunately")
  );
}

const DDG_UA = "Mozilla/5.0 (compatible; AgenticXPortalWebSearch/1.0)";

async function searchDuckDuckGoLite(
  query: string,
  maxResults: number,
  fetchImpl: FetchLike,
): Promise<WebSearchHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query }).toString()}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { "user-agent": DDG_UA },
    signal: AbortSignal.timeout(20_000),
  });
  const html = await response.text();
  // 202 / anomaly pages are still HTTP "ok" for fetch — must detect explicitly.
  if (!response.ok || looksLikeDdgChallenge(response.status, html)) {
    throw new Error(`duckduckgo lite challenge/http ${response.status}`);
  }
  const hits = parseDuckDuckGoLite(html, maxResults);
  if (hits.length === 0) {
    throw new Error("duckduckgo lite returned no parseable results");
  }
  return hits;
}

/**
 * Free DuckDuckGo search (no API key), aligned with Near `search_duckduckgo_html`:
 * HTML endpoint first → on challenge / empty / HTTP error, fall back to Lite.
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  fetchImpl: FetchLike,
): Promise<WebSearchHit[]> {
  const body = new URLSearchParams({ q: query });
  let htmlError: Error | null = null;
  try {
    const response = await fetchImpl("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": DDG_UA,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const html = await response.text();
    if (response.ok && !looksLikeDdgChallenge(response.status, html)) {
      const hits = parseDuckDuckGoHtml(html, maxResults);
      if (hits.length > 0) return hits;
    }
  } catch (error) {
    htmlError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    return await searchDuckDuckGoLite(query, maxResults, fetchImpl);
  } catch (liteError) {
    throw (
      htmlError ??
      (liteError instanceof Error ? liteError : new Error(String(liteError)))
    );
  }
}

async function searchBocha(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchLike,
  freshness?: BochaFreshness,
): Promise<WebSearchHit[]> {
  const payload: Record<string, unknown> = { query, count: maxResults, summary: true };
  if (freshness) payload.freshness = freshness;
  const response = await fetchImpl("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`bocha http ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: {
      webPages?: {
        value?: Array<{
          name?: string;
          url?: string;
          snippet?: string;
          summary?: string;
          datePublished?: string;
        }>;
      };
    };
  };
  const values = json.data?.webPages?.value ?? [];
  return values
    .slice(0, maxResults)
    .map((item) => ({
      title: String(item.name ?? "").trim() || item.url || "Untitled",
      url: String(item.url ?? "").trim(),
      snippet: truncateSnippet(String(item.summary ?? item.snippet ?? "")),
      publishedAt: String(item.datePublished ?? "").trim() || undefined,
    }))
    .filter((hit) => hit.url);
}

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<WebSearchHit[]> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`tavily http ${response.status}`);
  }
  const json = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (json.results ?? []).slice(0, maxResults).map((item) => ({
    title: String(item.title ?? "").trim() || item.url || "Untitled",
    url: String(item.url ?? "").trim(),
    snippet: truncateSnippet(String(item.content ?? "")),
  })).filter((hit) => hit.url);
}

export function formatHits(hits: WebSearchHit[]): string {
  if (hits.length === 0) return "No search results found.";
  return hits
    .map((hit, index) => {
      const date = hit.publishedAt ? `\n发布时间: ${hit.publishedAt}` : "";
      return `[${index + 1}] ${hit.title}\nURL: ${hit.url}${date}\n${hit.snippet}`;
    })
    .join("\n\n");
}

export async function executeWebSearch(
  query: string,
  maxResults: number | undefined,
  cfg: Pick<WebSearchRuntimeConfig, "provider" | "apiKey" | "maxResults">,
  fetchImpl: FetchLike = directFetch as FetchLike,
): Promise<WebSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const n = clampMaxResults(maxResults ?? cfg.maxResults ?? DEFAULT_MAX_RESULTS);
  const provider = cfg.provider || "duckduckgo";
  const freshness = resolveFreshness(q);

  try {
    if (provider === "bocha") {
      if (!cfg.apiKey.trim()) throw new Error("bocha api key missing");
      const hits = await searchBocha(q, n, cfg.apiKey, fetchImpl, freshness);
      if (hits.length > 0) return hits;
    } else if (provider === "tavily") {
      if (!cfg.apiKey.trim()) throw new Error("tavily api key missing");
      const hits = await searchTavily(q, n, cfg.apiKey, fetchImpl);
      if (hits.length > 0) return hits;
    } else {
      return await searchDuckDuckGo(q, n, fetchImpl);
    }
  } catch (error) {
    if (provider === "duckduckgo") throw error;
    console.warn(
      `[web-search] provider=${provider} failed, falling back to duckduckgo:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  return searchDuckDuckGo(q, n, fetchImpl);
}
