/**
 * Enterprise portal web search providers (TypeScript, independent of Desktop Python).
 */

import { directFetch, type DirectFetchInit } from "./direct-fetch";
import { resolveFreshness, type BochaFreshness } from "./freshness";
import {
  normalizeWebSearchEndpoint,
  normalizeWebSearchResultUrl,
  resolveSafeWebSearchEndpoint,
  type ResolvedWebSearchUrl,
} from "./provider-endpoint";

export const WEB_SEARCH_MAX_RESULTS_CAP = 50;
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_SNIPPET_CHARS = 600;

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** ISO8601，provider 提供时才有（当前仅 Bocha）。 */
  publishedAt?: string;
  /** Internal retrieval facet label; provider adapters never need to populate it. */
  searchQuery?: string;
};

/**
 * A configured provider instance. `id` is tenant-defined identity; `adapter`
 * names the request/response protocol implementation registered in this BFF.
 * Retry routing compares only `id`, so it never needs a vendor allowlist.
 */
export type WebSearchProviderConfig = {
  id: string;
  adapter: string;
  displayName: string;
  apiKey: string;
  enabled: boolean;
  priority: number;
  options?: Record<string, unknown>;
};

/** @deprecated Provider identity is now a configured string, not a closed union. */
export type WebSearchProviderName = string;

export type WebSearchRuntimeConfig = {
  enabled: boolean;
  /** Legacy mirror of the primary provider adapter. */
  provider: WebSearchProviderName;
  /** Legacy mirror of the primary provider secret. */
  apiKey: string;
  maxResults: number;
  /** Shared cap for standalone query facets plus any fallback-provider search. */
  maxSearchCalls?: number;
  primaryProviderId?: string;
  providers?: WebSearchProviderConfig[];
};

type FetchLike = (
  input: string | URL | Request,
  init?: DirectFetchInit,
) => Promise<Response>;

type WebSearchAdapterContext = {
  query: string;
  maxResults: number;
  apiKey: string;
  options: Record<string, unknown>;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
};

export type WebSearchAdapterDefinition = {
  id: string;
  displayName: string;
  requiresApiKey: boolean;
  /** Tenant instances may override the exact endpoint while keeping this protocol. */
  supportsCustomEndpoint?: boolean;
  defaultEndpoint?: string;
  search: (context: WebSearchAdapterContext) => Promise<WebSearchHit[]>;
};

export type WebSearchAdapterPublicDefinition = Omit<WebSearchAdapterDefinition, "search">;

export type WebSearchProviderAttempt = {
  providerId: string;
  outcome: "ok" | "empty" | "failed";
  hitCount: number;
  durationMs: number;
};

export type WebSearchExecutionDiagnostics = {
  /**
   * Authoritative admission hook, awaited immediately before a real provider
   * request. Rejecting here stops the attempt and every remaining failover.
   */
  beforeProviderAttempt?: (providerId: string) => void | Promise<void>;
  /** Best-effort observability only; observer failures never affect retrieval. */
  onProviderAttempt?: (attempt: WebSearchProviderAttempt) => void;
  /** Shared run cancellation/deadline; unlike diagnostics callbacks, this is authoritative. */
  signal?: AbortSignal;
};

const ADAPTERS = new Map<string, WebSearchAdapterDefinition>();

export const MAX_CONFIGURED_WEB_SEARCH_PROVIDERS = 2;

const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DOUBAO_CUSTOM_ENDPOINT = "https://open.feedcoopapi.com/search_api/web_search";
const SEARCH_REQUEST_TIMEOUT_MS = 20_000;

function searchRequestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/** Adapter registration is the only protocol-specific extension point. */
export function registerWebSearchAdapter(definition: WebSearchAdapterDefinition): void {
  const id = definition.id.trim().toLowerCase();
  if (!id) throw new Error("web search adapter id is required");
  ADAPTERS.set(id, { ...definition, id });
}

export function listWebSearchAdapters(): WebSearchAdapterPublicDefinition[] {
  return [...ADAPTERS.values()].map(({ search: _search, ...definition }) => definition);
}

export function getWebSearchAdapter(
  adapterId: string,
): WebSearchAdapterPublicDefinition | null {
  const definition = ADAPTERS.get(adapterId.trim().toLowerCase());
  if (!definition) return null;
  const { search: _search, ...publicDefinition } = definition;
  return publicDefinition;
}

export function publicProviderEndpoint(
  provider: Pick<WebSearchProviderConfig, "adapter" | "options">,
): string | undefined {
  const adapter = ADAPTERS.get(provider.adapter.trim().toLowerCase());
  if (!adapter?.supportsCustomEndpoint) return undefined;
  const raw = provider.options?.endpoint;
  if (typeof raw !== "string" || !raw.trim()) return adapter.defaultEndpoint;
  try {
    return normalizeWebSearchEndpoint(raw);
  } catch {
    return undefined;
  }
}

async function resolveAdapterEndpoint(
  options: Record<string, unknown>,
  defaultEndpoint: string,
): Promise<Pick<ResolvedWebSearchUrl, "url"> & { address?: string }> {
  const normalizedDefault = normalizeWebSearchEndpoint(defaultEndpoint);
  const raw = typeof options.endpoint === "string" && options.endpoint.trim()
    ? options.endpoint
    : normalizedDefault;
  const normalized = normalizeWebSearchEndpoint(raw);
  if (normalized === normalizedDefault) return { url: normalizedDefault };
  const resolved = await resolveSafeWebSearchEndpoint(normalized);
  return { url: resolved.url, address: resolved.address };
}

const PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

function endpointTransportInit(
  endpoint: Pick<ResolvedWebSearchUrl, "url"> & { address?: string },
): Pick<DirectFetchInit, "connectAddress" | "maxResponseBytes"> {
  return {
    ...(endpoint.address ? { connectAddress: endpoint.address } : {}),
    maxResponseBytes: PROVIDER_RESPONSE_BYTES,
  };
}

function sanitizeProviderHits(hits: WebSearchHit[]): WebSearchHit[] {
  return hits.flatMap((hit) => {
    try {
      return [{ ...hit, url: normalizeWebSearchResultUrl(hit.url) }];
    } catch {
      return [];
    }
  });
}

function clampQueryChars(query: string, maxChars: number): string {
  const chars = Array.from(query.trim());
  if (chars.length <= maxChars) return chars.join("");
  const tailChars = Math.min(29, maxChars - 2);
  const headChars = maxChars - tailChars - 1;
  return `${chars.slice(0, headChars).join("")} ${chars.slice(-tailChars).join("")}`;
}

export function isConfiguredWebSearchProvider(provider: WebSearchProviderConfig): boolean {
  if (!provider.enabled || !provider.id.trim()) return false;
  const adapter = ADAPTERS.get(provider.adapter.trim().toLowerCase());
  if (!adapter) return false;
  return !adapter.requiresApiKey || Boolean(provider.apiKey.trim());
}

export function configuredWebSearchProviders(
  config: Pick<
    WebSearchRuntimeConfig,
    "provider" | "apiKey" | "maxResults" | "primaryProviderId" | "providers"
  >,
): WebSearchProviderConfig[] {
  const configured = (config.providers ?? [])
    .filter(isConfiguredWebSearchProvider)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  // An explicit pool is authoritative, including the case where every entry is
  // disabled or missing credentials. Never resurrect a disabled legacy mirror.
  if ((config.providers?.length ?? 0) > 0) return configured;

  const adapter = config.provider.trim().toLowerCase();
  const legacy: WebSearchProviderConfig = {
    id: config.primaryProviderId?.trim() || adapter,
    adapter,
    displayName: ADAPTERS.get(adapter)?.displayName ?? adapter,
    apiKey: config.apiKey,
    enabled: true,
    priority: 0,
  };
  return isConfiguredWebSearchProvider(legacy) ? [legacy] : [];
}

export function primaryWebSearchProvider(
  config: Pick<
    WebSearchRuntimeConfig,
    "provider" | "apiKey" | "maxResults" | "primaryProviderId" | "providers"
  >,
): WebSearchProviderConfig | null {
  const providers = configuredWebSearchProviders(config);
  const primaryId = config.primaryProviderId?.trim();
  return providers.find((provider) => provider.id === primaryId) ?? providers[0] ?? null;
}

/** Narrow a runtime pool to one exact provider so adapters cannot hide fallback calls. */
export function configForWebSearchProvider(
  config: WebSearchRuntimeConfig,
  provider: WebSearchProviderConfig,
): WebSearchRuntimeConfig {
  return {
    ...config,
    provider: provider.adapter,
    apiKey: provider.apiKey,
    primaryProviderId: provider.id,
    providers: [provider],
  };
}

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
  signal?: AbortSignal,
): Promise<WebSearchHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query }).toString()}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { "user-agent": DDG_UA },
    signal: searchRequestSignal(signal),
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
  signal?: AbortSignal,
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
      signal: searchRequestSignal(signal),
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
    return await searchDuckDuckGoLite(query, maxResults, fetchImpl, signal);
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
  options: Record<string, unknown>,
  freshness?: BochaFreshness,
  signal?: AbortSignal,
): Promise<WebSearchHit[]> {
  const payload: Record<string, unknown> = { query, count: maxResults, summary: true };
  if (freshness) payload.freshness = freshness;
  const endpoint = await resolveAdapterEndpoint(options, BOCHA_ENDPOINT);
  const response = await fetchImpl(endpoint.url, {
    ...endpointTransportInit(endpoint),
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: searchRequestSignal(signal),
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
  options: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WebSearchHit[]> {
  const endpoint = await resolveAdapterEndpoint(options, TAVILY_ENDPOINT);
  const response = await fetchImpl(endpoint.url, {
    ...endpointTransportInit(endpoint),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
    }),
    signal: searchRequestSignal(signal),
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

async function searchDoubaoCustom(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchLike,
  options: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WebSearchHit[]> {
  const endpoint = await resolveAdapterEndpoint(options, DOUBAO_CUSTOM_ENDPOINT);
  const response = await fetchImpl(endpoint.url, {
    ...endpointTransportInit(endpoint),
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-traffic-tag": "skill_web_search_common",
    },
    body: JSON.stringify({
      Query: clampQueryChars(query, 100),
      SearchType: "web",
      Count: maxResults,
      NeedSummary: true,
    }),
    signal: searchRequestSignal(signal),
  });
  if (!response.ok) {
    throw new Error(`doubao search http ${response.status}`);
  }
  const json = (await response.json()) as {
    ResponseMetadata?: {
      Error?: { Code?: string; CodeN?: number; Message?: string } | null;
    };
    Result?: {
      WebResults?: Array<{
        Title?: string;
        Url?: string;
        Snippet?: string;
        Summary?: string;
        PublishTime?: string;
      }>;
    } | null;
  };
  const providerError = json.ResponseMetadata?.Error;
  if (providerError || !json.Result) {
    const detail = providerError?.Code ?? providerError?.CodeN ?? "empty result";
    throw new Error(`doubao search error ${detail}`);
  }
  return (json.Result.WebResults ?? [])
    .slice(0, maxResults)
    .map((item) => ({
      title: String(item.Title ?? "").trim() || item.Url || "Untitled",
      url: String(item.Url ?? "").trim(),
      snippet: truncateSnippet(String(item.Summary ?? item.Snippet ?? "")),
      publishedAt: String(item.PublishTime ?? "").trim() || undefined,
    }))
    .filter((hit) => hit.url);
}

export function formatHits(hits: WebSearchHit[]): string {
  if (hits.length === 0) return "No search results found.";
  return hits
    .map((hit, index) => {
      const date = hit.publishedAt ? `\n发布时间: ${hit.publishedAt}` : "";
      const facet = hit.searchQuery ? `\n检索子问题: ${hit.searchQuery}` : "";
      return `[${index + 1}] ${hit.title}${facet}\nURL: ${hit.url}${date}\n${hit.snippet}`;
    })
    .join("\n\n");
}

export async function executeWebSearch(
  query: string,
  maxResults: number | undefined,
  cfg: Pick<
    WebSearchRuntimeConfig,
    "provider" | "apiKey" | "maxResults" | "primaryProviderId" | "providers"
  >,
  fetchImpl: FetchLike = directFetch as FetchLike,
  diagnostics?: WebSearchExecutionDiagnostics,
): Promise<WebSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  if (diagnostics?.signal?.aborted) {
    throw diagnostics.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const n = clampMaxResults(maxResults ?? cfg.maxResults ?? DEFAULT_MAX_RESULTS);
  const providers = configuredWebSearchProviders(cfg).slice(0, MAX_CONFIGURED_WEB_SEARCH_PROVIDERS);
  if (providers.length === 0) throw new Error("no configured web search provider");

  let lastError: unknown = new Error("search returned no hits");
  for (const provider of providers) {
    if (diagnostics?.signal?.aborted) {
      throw diagnostics.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const attemptStartedAt = Date.now();
    const observe = (outcome: WebSearchProviderAttempt["outcome"], hitCount: number) => {
      try {
        diagnostics?.onProviderAttempt?.({
          providerId: provider.id,
          outcome,
          hitCount,
          durationMs: Math.max(0, Date.now() - attemptStartedAt),
        });
      } catch {
        // Diagnostics must never alter provider failover or the user response.
      }
    };
    const adapterId = provider.adapter.trim().toLowerCase();
    const adapter = ADAPTERS.get(adapterId);
    if (!adapter) {
      lastError = new Error(`web search adapter is not registered: ${adapterId}`);
      observe("failed", 0);
      continue;
    }
    if (adapter.requiresApiKey && !provider.apiKey.trim()) {
      lastError = new Error(`web search provider is missing credentials: ${provider.id}`);
      observe("failed", 0);
      continue;
    }
    // Deliberately outside the adapter try/catch: a hard run-budget or tenant
    // quota rejection must stop failover instead of being mistaken for a
    // provider failure. Admission is counted before the request goes out, so a
    // failed or timed-out attempt still consumes the tenant's daily allowance.
    await diagnostics?.beforeProviderAttempt?.(provider.id);
    try {
      const hits = sanitizeProviderHits(await adapter.search({
        query: q,
        maxResults: n,
        apiKey: provider.apiKey,
        options: provider.options ?? {},
        fetchImpl,
        signal: diagnostics?.signal,
      }));
      observe(hits.length > 0 ? "ok" : "empty", hits.length);
      if (hits.length > 0) return hits;
      lastError = new Error(`web search provider returned no hits: ${provider.id}`);
    } catch (error) {
      observe("failed", 0);
      if (diagnostics?.signal?.aborted) {
        throw diagnostics.signal.reason ?? error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

registerWebSearchAdapter({
  id: "duckduckgo",
  displayName: "DuckDuckGo",
  requiresApiKey: false,
  search: ({ query, maxResults, fetchImpl, signal }) =>
    searchDuckDuckGo(query, maxResults, fetchImpl, signal),
});

registerWebSearchAdapter({
  id: "bocha",
  displayName: "Bocha",
  requiresApiKey: true,
  supportsCustomEndpoint: true,
  defaultEndpoint: BOCHA_ENDPOINT,
  search: ({ query, maxResults, apiKey, options, fetchImpl, signal }) =>
    searchBocha(
      query,
      maxResults,
      apiKey,
      fetchImpl,
      options,
      resolveFreshness(query),
      signal,
    ),
});

registerWebSearchAdapter({
  id: "tavily",
  displayName: "Tavily",
  requiresApiKey: true,
  supportsCustomEndpoint: true,
  defaultEndpoint: TAVILY_ENDPOINT,
  search: ({ query, maxResults, apiKey, options, fetchImpl, signal }) =>
    searchTavily(query, maxResults, apiKey, fetchImpl, options, signal),
});

registerWebSearchAdapter({
  id: "doubao",
  displayName: "豆包搜索",
  requiresApiKey: true,
  supportsCustomEndpoint: true,
  defaultEndpoint: DOUBAO_CUSTOM_ENDPOINT,
  search: ({ query, maxResults, apiKey, options, fetchImpl, signal }) =>
    searchDoubaoCustom(query, maxResults, apiKey, fetchImpl, options, signal),
});
