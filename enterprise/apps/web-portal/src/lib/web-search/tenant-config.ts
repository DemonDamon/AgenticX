/**
 * Load / upsert tenant web-search config from PG or MySQL.
 */

import { enterpriseRuntimeWebSearch as pgTable } from "@agenticx/db-schema";
import { enterpriseRuntimeWebSearch as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { decryptProviderApiKey, encryptProviderApiKey } from "@agenticx/iam-core/provider-api-key-crypto";
import { eq } from "drizzle-orm";

import type { TenantWebSearchRow } from "./config";
import {
  DEFAULT_MAX_RESULTS,
  listWebSearchAdapters,
  type WebSearchAdapterPublicDefinition,
  type WebSearchProviderConfig,
  type WebSearchProviderName,
} from "./providers";

export type PublicWebSearchProvider = Omit<WebSearchProviderConfig, "apiKey" | "options"> & {
  hasApiKey: boolean;
};

export type WebSearchPublicConfig = {
  enabled: boolean;
  provider: WebSearchProviderName;
  maxResults: number;
  hasApiKey: boolean;
  deepResearchEnabled: boolean;
  providers: PublicWebSearchProvider[];
  availableAdapters: WebSearchAdapterPublicDefinition[];
};

export type WebSearchProviderUpdate = {
  id: string;
  adapter: string;
  displayName?: string;
  /** Empty string clears; undefined preserves the secret for the same provider id. */
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  options?: Record<string, unknown>;
};

export type WebSearchUpdateInput = {
  enabled?: boolean;
  provider?: string;
  maxResults?: number;
  /** Empty string clears key; undefined leaves unchanged. */
  apiKey?: string;
  deepResearchEnabled?: boolean;
  providers?: WebSearchProviderUpdate[];
};

function normalizeProvider(raw: string | undefined): WebSearchProviderName {
  const value = (raw ?? "duckduckgo").trim().toLowerCase();
  return value || "duckduckgo";
}

type StoredProvider = {
  id: string;
  adapter: string;
  displayName: string;
  apiKeyCipher: string;
  enabled: boolean;
  priority: number;
  options?: Record<string, unknown>;
};

function asOptions(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseStoredProviders(raw: unknown): WebSearchProviderConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const providers: WebSearchProviderConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<StoredProvider>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const adapter = typeof row.adapter === "string" ? normalizeProvider(row.adapter) : "";
    if (!id || !adapter || seen.has(id)) continue;
    seen.add(id);
    providers.push({
      id,
      adapter,
      displayName:
        typeof row.displayName === "string" && row.displayName.trim()
          ? row.displayName.trim()
          : id,
      apiKey: decryptProviderApiKey(
        typeof row.apiKeyCipher === "string" ? row.apiKeyCipher : "",
      ),
      enabled: row.enabled !== false,
      priority:
        typeof row.priority === "number" && Number.isFinite(row.priority)
          ? row.priority
          : providers.length,
      options: asOptions(row.options),
    });
  }
  return providers.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function storedProviders(providers: WebSearchProviderConfig[]): StoredProvider[] {
  return providers.map((provider, index) => ({
    id: provider.id,
    adapter: provider.adapter,
    displayName: provider.displayName,
    apiKeyCipher: encryptProviderApiKey(provider.apiKey),
    enabled: provider.enabled,
    priority: index,
    options: provider.options,
  }));
}

function legacyProvider(provider: string, apiKey: string): WebSearchProviderConfig {
  const adapter = normalizeProvider(provider);
  return {
    id: adapter,
    adapter,
    displayName: listWebSearchAdapters().find((item) => item.id === adapter)?.displayName ?? adapter,
    apiKey,
    enabled: true,
    priority: 0,
  };
}

function publicProviders(providers: WebSearchProviderConfig[]): PublicWebSearchProvider[] {
  return providers.map(({ apiKey, options: _options, ...provider }) => ({
    ...provider,
    hasApiKey: Boolean(apiKey.trim()),
  }));
}

function normalizeProviderUpdates(
  updates: WebSearchProviderUpdate[],
  existing: WebSearchProviderConfig[],
): WebSearchProviderConfig[] {
  const existingById = new Map(existing.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const providers: WebSearchProviderConfig[] = [];
  for (const update of updates) {
    const id = typeof update?.id === "string" ? update.id.trim() : "";
    const adapter =
      typeof update?.adapter === "string" ? normalizeProvider(update.adapter) : "";
    if (!id || !adapter || seen.has(id)) continue;
    seen.add(id);
    const previous = existingById.get(id);
    providers.push({
      id,
      adapter,
      displayName: update.displayName?.trim() || previous?.displayName || id,
      apiKey: update.apiKey === undefined ? previous?.apiKey ?? "" : update.apiKey,
      enabled: update.enabled ?? previous?.enabled ?? true,
      priority:
        typeof update.priority === "number" && Number.isFinite(update.priority)
          ? update.priority
          : providers.length,
      options: asOptions(update.options) ?? previous?.options,
    });
  }
  return providers.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export async function loadTenantWebSearchConfig(tenantId: string): Promise<TenantWebSearchRow> {
  const tid = tenantId.trim();
  if (!tid || !process.env.DATABASE_URL?.trim()) return null;

  try {
    const config = resolveDatabaseConfig();
    if (config.dialect === "mysql") {
      const { raw: db } = await createMysqlDb(config);
      const rows = await db.select().from(mysqlTable).where(eq(mysqlTable.tenantId, tid)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        enabled: Boolean(row.enabled),
        provider: row.provider,
        apiKey: decryptProviderApiKey(row.apiKeyCipher ?? ""),
        providers: parseStoredProviders(row.providers),
        maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
        deepResearchEnabled: Boolean(row.deepResearchEnabled),
      };
    }

    const db = getIamDb();
    const rows = await db.select().from(pgTable).where(eq(pgTable.tenantId, tid)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      enabled: Boolean(row.enabled),
      provider: row.provider,
      apiKey: decryptProviderApiKey(row.apiKeyCipher ?? ""),
      providers: parseStoredProviders(row.providers),
      maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
      deepResearchEnabled: Boolean(row.deepResearchEnabled),
    };
  } catch {
    return null;
  }
}

export async function getPublicWebSearchConfig(tenantId: string): Promise<WebSearchPublicConfig> {
  const row = await loadTenantWebSearchConfig(tenantId);
  if (!row) {
    return {
      enabled: true,
      provider: "duckduckgo",
      maxResults: DEFAULT_MAX_RESULTS,
      hasApiKey: false,
      deepResearchEnabled: true,
      providers: [],
      availableAdapters: listWebSearchAdapters(),
    };
  }
  return {
    enabled: row.enabled,
    provider: normalizeProvider(row.provider),
    maxResults: row.maxResults,
    hasApiKey: Boolean(row.apiKey.trim()),
    deepResearchEnabled: Boolean(row.deepResearchEnabled),
    providers: publicProviders(
      row.providers?.length ? row.providers : [legacyProvider(row.provider, row.apiKey)],
    ),
    availableAdapters: listWebSearchAdapters(),
  };
}

export async function upsertTenantWebSearchConfig(
  tenantId: string,
  input: WebSearchUpdateInput,
): Promise<WebSearchPublicConfig> {
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to persist web search settings");
  }

  const existing = await loadTenantWebSearchConfig(tid);
  const nextEnabled = input.enabled ?? existing?.enabled ?? true;
  const existingProviders = existing?.providers?.length
    ? existing.providers
    : existing
      ? [legacyProvider(existing.provider, existing.apiKey)]
      : [];
  let nextProviders =
    input.providers !== undefined
      ? normalizeProviderUpdates(input.providers, existingProviders)
      : existingProviders.slice();

  if (input.provider !== undefined && input.providers === undefined) {
    const selectedAdapter = normalizeProvider(input.provider);
    const index = nextProviders.findIndex(
      (provider) => provider.id === input.provider?.trim() || provider.adapter === selectedAdapter,
    );
    const selected =
      index >= 0
        ? nextProviders.splice(index, 1)[0]!
        : legacyProvider(selectedAdapter, "");
    nextProviders.unshift(selected);
  }

  if (nextProviders.length === 0) {
    nextProviders = [legacyProvider(input.provider ?? existing?.provider ?? "duckduckgo", "")];
  }

  if (input.apiKey !== undefined) {
    nextProviders[0] = { ...nextProviders[0]!, apiKey: input.apiKey };
  }
  nextProviders = nextProviders.map((provider, priority) => ({ ...provider, priority }));

  const primary = nextProviders[0]!;
  const nextProvider = primary.adapter;
  const nextMax = input.maxResults ?? existing?.maxResults ?? DEFAULT_MAX_RESULTS;
  const nextDeepResearch =
    input.deepResearchEnabled ?? existing?.deepResearchEnabled ?? true;
  const nextKey = primary.apiKey;
  const cipher = encryptProviderApiKey(nextKey);
  const providerRows = storedProviders(nextProviders);
  const updatedAt = new Date();

  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    await db
      .insert(mysqlTable)
      .values({
        tenantId: tid,
        enabled: nextEnabled,
        provider: nextProvider,
        apiKeyCipher: cipher,
        providers: providerRows,
        maxResults: nextMax,
        deepResearchEnabled: nextDeepResearch,
        updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: nextEnabled,
          provider: nextProvider,
          apiKeyCipher: cipher,
          providers: providerRows,
          maxResults: nextMax,
          deepResearchEnabled: nextDeepResearch,
          updatedAt,
        },
      });
  } else {
    const db = getIamDb();
    await db
      .insert(pgTable)
      .values({
        tenantId: tid,
        enabled: nextEnabled,
        provider: nextProvider,
        apiKeyCipher: cipher,
        providers: providerRows,
        maxResults: nextMax,
        deepResearchEnabled: nextDeepResearch,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: pgTable.tenantId,
        set: {
          enabled: nextEnabled,
          provider: nextProvider,
          apiKeyCipher: cipher,
          providers: providerRows,
          maxResults: nextMax,
          deepResearchEnabled: nextDeepResearch,
          updatedAt,
        },
      });
  }

  return {
    enabled: nextEnabled,
    provider: nextProvider,
    maxResults: nextMax,
    hasApiKey: Boolean(nextKey.trim()),
    deepResearchEnabled: nextDeepResearch,
    providers: publicProviders(nextProviders),
    availableAdapters: listWebSearchAdapters(),
  };
}
