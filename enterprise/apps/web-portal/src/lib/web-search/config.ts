/**
 * Resolve tenant web-search runtime config: PG → env → defaults.
 */

import type {
  WebSearchProviderConfig,
  WebSearchProviderName,
  WebSearchRuntimeConfig,
} from "./providers";
import { DEFAULT_MAX_RESULTS } from "./providers";
import {
  DEFAULT_MAX_SEARCH_CALLS,
  normalizeMaxSearchCalls,
} from "./search-call-budget";
import {
  DEFAULT_BACKEND_CHAIN,
  type PageFetchBackendName,
} from "./page-fetch-backends";
import {
  DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
  normalizeMaxDeepResearchProviderCalls,
} from "../deep-research/budget-ledger";

export type TenantWebSearchRow = {
  enabled: boolean;
  provider: string;
  apiKey: string;
  maxResults: number;
  /** Shared ordinary-search provider-call cap; absent legacy rows use 3. */
  maxSearchCalls?: number;
  /** Independent deep-research provider-attempt cap; includes failover attempts. */
  maxDeepResearchProviderCalls?: number;
  /** Ordered, decrypted provider instances; absent rows retain legacy single-provider behavior. */
  providers?: WebSearchProviderConfig[];
  primaryProviderId?: string;
  /** Tenant deep-research switch; missing legacy config currently defaults to enabled. */
  deepResearchEnabled?: boolean;
  /**
   * Tenant rollback switch for deterministic calculation. Absent on a database
   * that predates the column, which is read as OFF: a schema we cannot confirm
   * should restore the answer path that existed before the calculator, not
   * assume a feature the operator never enabled.
   */
  calculatorEnabled?: boolean;
  /** 逗号分隔的后端链，如 "native,jina"。 */
  pageFetchBackends?: string;
  pageFetchJinaApiKey?: string;
  pageFetchFirecrawlApiKey?: string;
  archivePages?: boolean;
} | null;

export type PageFetchRuntimeConfig = {
  backends: PageFetchBackendName[];
  apiKeys: Partial<Record<PageFetchBackendName, string>>;
  archivePages: boolean;
};

function normalizeProvider(raw: string | undefined): WebSearchProviderName {
  const value = (raw ?? "duckduckgo").trim().toLowerCase();
  return value || "duckduckgo";
}

function normalizeProviderPool(raw: unknown): WebSearchProviderConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const providers: WebSearchProviderConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const adapter =
      typeof row.adapter === "string" ? normalizeProvider(row.adapter) : "";
    if (!id || !adapter || seen.has(id)) continue;
    seen.add(id);
    providers.push({
      id,
      adapter,
      displayName:
        typeof row.displayName === "string" && row.displayName.trim()
          ? row.displayName.trim()
          : id,
      apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
      enabled: row.enabled !== false,
      priority:
        typeof row.priority === "number" && Number.isFinite(row.priority)
          ? row.priority
          : providers.length,
      options:
        row.options && typeof row.options === "object" && !Array.isArray(row.options)
          ? (row.options as Record<string, unknown>)
          : undefined,
    });
  }
  return providers.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function envProviderPool(): WebSearchProviderConfig[] {
  const raw = process.env.WEB_SEARCH_PROVIDERS_JSON?.trim();
  if (!raw) return [];
  try {
    return normalizeProviderPool(JSON.parse(raw));
  } catch {
    console.warn("[web-search] WEB_SEARCH_PROVIDERS_JSON is invalid; using legacy config");
    return [];
  }
}

function isBackendName(raw: string): raw is PageFetchBackendName {
  return raw === "native" || raw === "jina" || raw === "firecrawl";
}

function parseBackendChain(raw: string | undefined): PageFetchBackendName[] {
  if (!raw?.trim()) return [...DEFAULT_BACKEND_CHAIN];
  const parsed = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(isBackendName);
  return parsed.length > 0 ? parsed : [...DEFAULT_BACKEND_CHAIN];
}

function parseArchiveFlag(raw: string | undefined, tenantFlag?: boolean): boolean {
  if (typeof tenantFlag === "boolean") return tenantFlag;
  if (raw == null) return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

export function resolveWebSearchConfig(tenant: TenantWebSearchRow): WebSearchRuntimeConfig {
  if (tenant) {
    const providers = normalizeProviderPool(tenant.providers);
    return {
      enabled: Boolean(tenant.enabled),
      provider: normalizeProvider(tenant.provider),
      apiKey: tenant.apiKey ?? "",
      maxResults: Number.isFinite(tenant.maxResults) ? tenant.maxResults : DEFAULT_MAX_RESULTS,
      maxSearchCalls: normalizeMaxSearchCalls(tenant.maxSearchCalls),
      primaryProviderId: tenant.primaryProviderId?.trim() || providers[0]?.id,
      providers,
    };
  }

  const envProvider = process.env.WEB_SEARCH_PROVIDER;
  const envKey = process.env.WEB_SEARCH_API_KEY ?? "";
  const envMax = Number(process.env.WEB_SEARCH_MAX_RESULTS ?? DEFAULT_MAX_RESULTS);
  const providers = envProviderPool();

  return {
    enabled: true,
    provider: providers[0]?.adapter ?? normalizeProvider(envProvider),
    apiKey: providers[0]?.apiKey ?? envKey,
    maxResults: Number.isFinite(envMax) ? envMax : DEFAULT_MAX_RESULTS,
    maxSearchCalls: DEFAULT_MAX_SEARCH_CALLS,
    primaryProviderId:
      process.env.WEB_SEARCH_PRIMARY_PROVIDER_ID?.trim() || providers[0]?.id,
    providers,
  };
}

export function resolvePageFetchConfig(tenant: TenantWebSearchRow): PageFetchRuntimeConfig {
  const backends = parseBackendChain(
    tenant?.pageFetchBackends ?? process.env.PAGE_FETCH_BACKENDS,
  );

  const jinaKey =
    tenant?.pageFetchJinaApiKey?.trim() ||
    process.env.PAGE_FETCH_JINA_API_KEY?.trim() ||
    "";
  const firecrawlKey =
    tenant?.pageFetchFirecrawlApiKey?.trim() ||
    process.env.PAGE_FETCH_FIRECRAWL_API_KEY?.trim() ||
    "";

  const apiKeys: Partial<Record<PageFetchBackendName, string>> = {};
  if (jinaKey) apiKeys.jina = jinaKey;
  if (firecrawlKey) apiKeys.firecrawl = firecrawlKey;

  return {
    backends,
    apiKeys,
    archivePages: parseArchiveFlag(process.env.PAGE_FETCH_ARCHIVE, tenant?.archivePages),
  };
}

export function resolveDeepResearchProviderCallLimit(tenant: TenantWebSearchRow): number {
  return tenant
    ? normalizeMaxDeepResearchProviderCalls(tenant.maxDeepResearchProviderCalls)
    : DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS;
}
