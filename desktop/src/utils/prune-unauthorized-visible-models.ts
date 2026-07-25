/**
 * Prune visible provider models that fail gateway Model Auth checks.
 *
 * Author: Damon Li
 */

import {
  isProviderCredentialed,
  listProviderVisibleModelIds,
  normalizeProviderEntry,
  type ProviderCatalogEntry,
} from "./model-options";

export type HealthCheckLikeResult = {
  ok: boolean;
  reason?: "unauthorized" | "error";
  error?: string;
};

export type RemovedUnauthorizedModel = {
  provider: string;
  model: string;
};

/**
 * Remove unauthorized model ids from a provider entry and realign `model`.
 */
export function stripUnauthorizedModelsFromEntry(
  entry: ProviderCatalogEntry,
  unauthorizedIds: ReadonlySet<string> | Iterable<string>,
): { entry: ProviderCatalogEntry; removed: string[] } {
  const deny = unauthorizedIds instanceof Set
    ? unauthorizedIds
    : new Set(Array.from(unauthorizedIds));
  const removed = (entry.models ?? []).filter((m) => deny.has(m));
  if (removed.length === 0) {
    return { entry: normalizeProviderEntry(entry), removed: [] };
  }
  const nextModels = (entry.models ?? []).filter((m) => !deny.has(m));
  let nextModel = (entry.model ?? "").trim();
  if (!nextModels.includes(nextModel)) {
    nextModel = nextModels[0] ?? "";
  }
  return {
    entry: normalizeProviderEntry({ ...entry, models: nextModels, model: nextModel }),
    removed,
  };
}

/**
 * Probe visible models for each credentialed provider; strip those marked unauthorized.
 * Network / generic probe failures keep the model visible (avoid false removals).
 */
export async function scanAndPruneUnauthorizedVisibleModels(input: {
  providers: Record<string, ProviderCatalogEntry>;
  healthCheck: (args: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) => Promise<HealthCheckLikeResult>;
}): Promise<{
  providers: Record<string, ProviderCatalogEntry>;
  removed: RemovedUnauthorizedModel[];
  changedProviderIds: string[];
}> {
  const next: Record<string, ProviderCatalogEntry> = { ...input.providers };
  const removed: RemovedUnauthorizedModel[] = [];
  const changed = new Set<string>();

  for (const [providerId, entry] of Object.entries(input.providers)) {
    if (!entry || entry.enabled === false) continue;
    if (!isProviderCredentialed(entry)) continue;
    const visible = listProviderVisibleModelIds(entry);
    if (visible.length === 0) continue;

    const unauthorized = new Set<string>();
    for (const model of visible) {
      // Sequential: same cadence as SettingsPanel batch health check.
      // eslint-disable-next-line no-await-in-loop
      const res = await input.healthCheck({
        provider: providerId,
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl || undefined,
        model,
      });
      if (!res.ok && res.reason === "unauthorized") {
        unauthorized.add(model);
      }
    }
    if (unauthorized.size === 0) continue;

    const stripped = stripUnauthorizedModelsFromEntry(entry, unauthorized);
    next[providerId] = stripped.entry;
    changed.add(providerId);
    for (const model of stripped.removed) {
      removed.push({ provider: providerId, model });
    }
  }

  return {
    providers: next,
    removed,
    changedProviderIds: Array.from(changed),
  };
}
