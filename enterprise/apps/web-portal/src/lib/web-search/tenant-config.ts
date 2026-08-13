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
  DEFAULT_MAX_SEARCH_CALLS,
  normalizeMaxSearchCalls,
} from "./search-call-budget";
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
  maxSearchCalls: number;
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
  maxSearchCalls?: number;
  /** Empty string clears key; undefined leaves unchanged. */
  apiKey?: string;
  deepResearchEnabled?: boolean;
  providers?: WebSearchProviderUpdate[];
};

type StoredWebSearchConfigRow = {
  enabled: unknown;
  provider: string;
  apiKeyCipher?: string | null;
  providers: unknown;
  maxResults: unknown;
  maxSearchCalls?: unknown;
  deepResearchEnabled: unknown;
};

type WebSearchConfigRead = {
  rows: StoredWebSearchConfigRow[];
  usedLegacySearchCallBudget: boolean;
};

/**
 * Recognize only the rolling-deploy failure introduced by the new budget
 * column. Other missing columns and all connectivity failures must remain
 * visible to strict callers.
 */
export function isMissingMaxSearchCallsColumnError(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    if (visited.has(current)) return false;
    visited.add(current);

    const row = current as Record<string, unknown>;
    const code = row.code;
    const errno = row.errno;
    const isUndefinedColumn =
      code === "42703" ||
      code === "ER_BAD_FIELD_ERROR" ||
      code === 1054 ||
      code === "1054" ||
      errno === 1054 ||
      errno === "1054";
    const details = [row.message, row.sqlMessage, row.detail, row.column]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();

    if (isUndefinedColumn && details.includes("max_search_calls")) return true;
    current = row.cause;
  }

  return false;
}

export async function readWebSearchConfigWithLegacyColumnFallback(
  readCurrent: () => Promise<StoredWebSearchConfigRow[]>,
  readLegacy: () => Promise<StoredWebSearchConfigRow[]>,
): Promise<WebSearchConfigRead> {
  try {
    return {
      rows: await readCurrent(),
      usedLegacySearchCallBudget: false,
    };
  } catch (error) {
    if (!isMissingMaxSearchCallsColumnError(error)) throw error;
    return {
      rows: await readLegacy(),
      usedLegacySearchCallBudget: true,
    };
  }
}

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

export function mapStoredWebSearchConfigRow(
  row: StoredWebSearchConfigRow,
  usedLegacySearchCallBudget = false,
): Exclude<TenantWebSearchRow, null> {
  return {
    enabled: Boolean(row.enabled),
    provider: row.provider,
    apiKey: decryptProviderApiKey(row.apiKeyCipher ?? ""),
    providers: parseStoredProviders(row.providers),
    maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
    maxSearchCalls: usedLegacySearchCallBudget
      ? DEFAULT_MAX_SEARCH_CALLS
      : normalizeMaxSearchCalls(row.maxSearchCalls),
    deepResearchEnabled: Boolean(row.deepResearchEnabled),
  };
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

/**
 * Strict runtime read: an absent row is `null`, while database/configuration
 * failures reject. High-cost feature gates must not confuse those two states.
 */
export async function loadTenantWebSearchConfigStrict(
  tenantId: string,
): Promise<TenantWebSearchRow> {
  const tid = tenantId.trim();
  if (!tid || !process.env.DATABASE_URL?.trim()) return null;

  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    const { rows, usedLegacySearchCallBudget } =
      await readWebSearchConfigWithLegacyColumnFallback(
        () => db.select().from(mysqlTable).where(eq(mysqlTable.tenantId, tid)).limit(1),
        () =>
          db
            .select({
              enabled: mysqlTable.enabled,
              provider: mysqlTable.provider,
              apiKeyCipher: mysqlTable.apiKeyCipher,
              providers: mysqlTable.providers,
              maxResults: mysqlTable.maxResults,
              deepResearchEnabled: mysqlTable.deepResearchEnabled,
            })
            .from(mysqlTable)
            .where(eq(mysqlTable.tenantId, tid))
            .limit(1),
      );
    const row = rows[0];
    if (!row) return null;
    return mapStoredWebSearchConfigRow(row, usedLegacySearchCallBudget);
  }

  const db = getIamDb();
  const { rows, usedLegacySearchCallBudget } =
    await readWebSearchConfigWithLegacyColumnFallback(
      () => db.select().from(pgTable).where(eq(pgTable.tenantId, tid)).limit(1),
      () =>
        db
          .select({
            enabled: pgTable.enabled,
            provider: pgTable.provider,
            apiKeyCipher: pgTable.apiKeyCipher,
            providers: pgTable.providers,
            maxResults: pgTable.maxResults,
            deepResearchEnabled: pgTable.deepResearchEnabled,
          })
          .from(pgTable)
          .where(eq(pgTable.tenantId, tid))
          .limit(1),
    );
  const row = rows[0];
  if (!row) return null;
  return mapStoredWebSearchConfigRow(row, usedLegacySearchCallBudget);
}

/** Best-effort ordinary-search runtime read; policy gates and settings use the strict loader. */
export async function loadTenantWebSearchConfig(tenantId: string): Promise<TenantWebSearchRow> {
  try {
    return await loadTenantWebSearchConfigStrict(tenantId);
  } catch {
    return null;
  }
}

export async function getPublicWebSearchConfig(tenantId: string): Promise<WebSearchPublicConfig> {
  // Settings reads must distinguish an absent row from a database/decryption
  // failure. Returning defaults on failure would misrepresent tenant policy.
  const row = await loadTenantWebSearchConfigStrict(tenantId);
  if (!row) {
    return {
      enabled: true,
      provider: "duckduckgo",
      maxResults: DEFAULT_MAX_RESULTS,
      maxSearchCalls: DEFAULT_MAX_SEARCH_CALLS,
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
    maxSearchCalls: normalizeMaxSearchCalls(row.maxSearchCalls),
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

  // Never treat a failed existing-config read as a fresh tenant: doing so could
  // replace the configured provider pool and encrypted credentials with defaults.
  const existing = await loadTenantWebSearchConfigStrict(tid);
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
  const nextMaxSearchCalls = normalizeMaxSearchCalls(
    input.maxSearchCalls ?? existing?.maxSearchCalls,
  );
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
        maxSearchCalls: nextMaxSearchCalls,
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
          maxSearchCalls: nextMaxSearchCalls,
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
        maxSearchCalls: nextMaxSearchCalls,
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
          maxSearchCalls: nextMaxSearchCalls,
          deepResearchEnabled: nextDeepResearch,
          updatedAt,
        },
      });
  }

  return {
    enabled: nextEnabled,
    provider: nextProvider,
    maxResults: nextMax,
    maxSearchCalls: nextMaxSearchCalls,
    hasApiKey: Boolean(nextKey.trim()),
    deepResearchEnabled: nextDeepResearch,
    providers: publicProviders(nextProviders),
    availableAdapters: listWebSearchAdapters(),
  };
}
