/**
 * Resolve tenant web-search runtime config: PG → env → defaults.
 */

import type { WebSearchProviderName, WebSearchRuntimeConfig } from "./providers";
import { DEFAULT_MAX_RESULTS } from "./providers";
import {
  DEFAULT_BACKEND_CHAIN,
  type PageFetchBackendName,
} from "./page-fetch-backends";

export type TenantWebSearchRow = {
  enabled: boolean;
  provider: string;
  apiKey: string;
  maxResults: number;
  /** Opt-in deep research (default false). */
  deepResearchEnabled?: boolean;
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
  if (value === "bocha" || value === "tavily" || value === "duckduckgo") return value;
  return "duckduckgo";
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
    return {
      enabled: Boolean(tenant.enabled),
      provider: normalizeProvider(tenant.provider),
      apiKey: tenant.apiKey ?? "",
      maxResults: Number.isFinite(tenant.maxResults) ? tenant.maxResults : DEFAULT_MAX_RESULTS,
    };
  }

  const envProvider = process.env.WEB_SEARCH_PROVIDER;
  const envKey = process.env.WEB_SEARCH_API_KEY ?? "";
  const envMax = Number(process.env.WEB_SEARCH_MAX_RESULTS ?? DEFAULT_MAX_RESULTS);

  return {
    enabled: true,
    provider: normalizeProvider(envProvider),
    apiKey: envKey,
    maxResults: Number.isFinite(envMax) ? envMax : DEFAULT_MAX_RESULTS,
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
