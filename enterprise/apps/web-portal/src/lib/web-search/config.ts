/**
 * Resolve tenant web-search runtime config: PG → env → defaults.
 */

import type { WebSearchProviderName, WebSearchRuntimeConfig } from "./providers";
import { DEFAULT_MAX_RESULTS } from "./providers";

export type TenantWebSearchRow = {
  enabled: boolean;
  provider: string;
  apiKey: string;
  maxResults: number;
  /** Opt-in deep research (default false). */
  deepResearchEnabled?: boolean;
} | null;

function normalizeProvider(raw: string | undefined): WebSearchProviderName {
  const value = (raw ?? "duckduckgo").trim().toLowerCase();
  if (value === "bocha" || value === "tavily" || value === "duckduckgo") return value;
  return "duckduckgo";
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
