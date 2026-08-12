/** Cost-bounded, provider-agnostic retry policy for ordinary web search. */

import type { WebSearchHit, WebSearchProviderConfig } from "./providers";

/** A successful result must be this sparse before a second provider call is allowed. */
export const SPARSE_RESULT_MAX_UNIQUE_URLS = 2;

function canonicalUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function sourceHost(raw: string): string {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

export type SearchEvidenceQuality = {
  retry: boolean;
  uniqueUrls: number;
  uniqueHosts: number;
};

/**
 * No intent regex and no extra model call: retry only when the provider returned
 * at most two unique URLs and every valid URL came from the same host.
 */
export function assessSearchEvidence(hits: WebSearchHit[]): SearchEvidenceQuality {
  const urls = new Set(hits.map((hit) => canonicalUrl(hit.url)).filter(Boolean));
  const hosts = new Set(hits.map((hit) => sourceHost(hit.url)).filter(Boolean));
  return {
    retry:
      urls.size > 0 &&
      urls.size <= SPARSE_RESULT_MAX_UNIQUE_URLS &&
      hosts.size === 1,
    uniqueUrls: urls.size,
    uniqueHosts: hosts.size,
  };
}

/** Pick the next configured instance by priority without knowing its vendor. */
export function selectAlternativeProvider(
  providers: WebSearchProviderConfig[],
  currentProviderId: string,
): WebSearchProviderConfig | null {
  const current = providers.find((provider) => provider.id === currentProviderId);
  const candidates = providers.filter((provider) => provider.id !== currentProviderId);
  if (!current) return candidates[0] ?? null;
  return (
    candidates.find((provider) => provider.adapter !== current.adapter) ??
    candidates[0] ??
    null
  );
}

/** Preserve first-provider ordering and append only new evidence. */
export function mergeSearchHits(
  primary: WebSearchHit[],
  complement: WebSearchHit[],
): WebSearchHit[] {
  const merged: WebSearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...primary, ...complement]) {
    const key = canonicalUrl(hit.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}
