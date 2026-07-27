/**
 * Enterprise portal web search providers (TypeScript, independent of Desktop Python).
 */

import { directFetch } from "./direct-fetch";

export const WEB_SEARCH_MAX_RESULTS_CAP = 50;
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_SNIPPET_CHARS = 600;

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
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

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  fetchImpl: FetchLike,
): Promise<WebSearchHit[]> {
  const body = new URLSearchParams({ q: query });
  const response = await fetchImpl("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; AgenticXPortalWebSearch/1.0)",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`duckduckgo http ${response.status}`);
  }
  const html = await response.text();
  const hits = parseDuckDuckGoHtml(html, maxResults);
  // DDG sometimes returns 2xx anomaly/challenge HTML with zero result__a anchors.
  if (hits.length === 0) {
    throw new Error("duckduckgo returned no parseable results");
  }
  return hits;
}

async function searchBocha(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<WebSearchHit[]> {
  const response = await fetchImpl("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, count: maxResults }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`bocha http ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
  };
  const values = json.data?.webPages?.value ?? [];
  return values.slice(0, maxResults).map((item) => ({
    title: String(item.name ?? "").trim() || item.url || "Untitled",
    url: String(item.url ?? "").trim(),
    snippet: truncateSnippet(String(item.snippet ?? "")),
  })).filter((hit) => hit.url);
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
    .map((hit, index) => `[${index + 1}] ${hit.title}\nURL: ${hit.url}\n${hit.snippet}`)
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

  try {
    if (provider === "bocha") {
      if (!cfg.apiKey.trim()) throw new Error("bocha api key missing");
      const hits = await searchBocha(q, n, cfg.apiKey, fetchImpl);
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
    // Fall back to duckduckgo for paid providers (aligned with Desktop service.py).
  }

  return searchDuckDuckGo(q, n, fetchImpl);
}
