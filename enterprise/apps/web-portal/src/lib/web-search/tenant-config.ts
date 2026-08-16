/**
 * Load / upsert tenant web-search config from PG or MySQL.
 */

import { enterpriseRuntimeWebSearch as pgTable } from "@agenticx/db-schema";
import { enterpriseRuntimeWebSearch as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { decryptProviderApiKeyStrict, encryptProviderApiKey } from "@agenticx/iam-core/provider-api-key-crypto";
import { eq } from "drizzle-orm";

import type { TenantWebSearchRow } from "./config";
import {
  DEFAULT_MAX_SEARCH_CALLS,
  normalizeMaxSearchCalls,
} from "./search-call-budget";
import {
  DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
  normalizeMaxDeepResearchProviderCalls,
} from "../deep-research/budget-ledger";
import {
  DEFAULT_MAX_RESULTS,
  getWebSearchAdapter,
  isConfiguredWebSearchProvider,
  listWebSearchAdapters,
  MAX_CONFIGURED_WEB_SEARCH_PROVIDERS,
  publicProviderEndpoint,
  type WebSearchAdapterPublicDefinition,
  type WebSearchProviderConfig,
  type WebSearchProviderName,
} from "./providers";

export type PublicWebSearchProvider = Omit<WebSearchProviderConfig, "apiKey" | "options"> & {
  hasApiKey: boolean;
  /** Safe, non-secret protocol endpoint; arbitrary adapter options stay server-only. */
  endpoint?: string;
};

export type WebSearchPublicConfig = {
  enabled: boolean;
  provider: WebSearchProviderName;
  maxResults: number;
  maxSearchCalls: number;
  maxDeepResearchProviderCalls: number;
  hasApiKey: boolean;
  deepResearchEnabled: boolean;
  /** Admin-only; the portal strips this before it reaches an ordinary user. */
  calculatorEnabled: boolean;
  primaryProviderId: string;
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
  maxDeepResearchProviderCalls?: number;
  /** Empty string clears key; undefined leaves unchanged. */
  apiKey?: string;
  deepResearchEnabled?: boolean;
  calculatorEnabled?: boolean;
  providers?: WebSearchProviderUpdate[];
};

type StoredWebSearchConfigRow = {
  enabled: unknown;
  provider: string;
  apiKeyCipher?: string | null;
  providers?: unknown;
  maxResults: unknown;
  maxSearchCalls?: unknown;
  maxDeepResearchProviderCalls?: unknown;
  deepResearchEnabled: unknown;
  /** Absent on a pre-migration database; that reads as off. */
  calculatorEnabled?: unknown;
};

type WebSearchConfigRead = {
  rows: StoredWebSearchConfigRow[];
  usedLegacySearchCallBudget: boolean;
  usedLegacyDeepResearchBudget: boolean;
  usedLegacyProviderPool: boolean;
};

const MAX_PROVIDER_ID_CHARS = 128;
const MAX_PROVIDER_DISPLAY_NAME_CHARS = 80;
const MAX_PROVIDER_API_KEY_CHARS = 8_192;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class WebSearchConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchConfigValidationError";
  }
}

function isMissingWebSearchConfigColumnError(
  error: unknown,
  columnName:
    | "max_search_calls"
    | "max_deep_research_provider_calls"
    | "providers"
    | "calculator_enabled",
): boolean {
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

    if (isUndefinedColumn && details.includes(columnName)) return true;
    current = row.cause;
  }

  return false;
}

/** Recognize only the expected rolling-deploy failure for the budget column. */
export function isMissingMaxSearchCallsColumnError(error: unknown): boolean {
  return isMissingWebSearchConfigColumnError(error, "max_search_calls");
}

/** Recognize only the expected rolling-deploy failure for the deep-research budget column. */
export function isMissingDeepResearchProviderBudgetColumnError(error: unknown): boolean {
  return isMissingWebSearchConfigColumnError(
    error,
    "max_deep_research_provider_calls",
  );
}

/** Recognize only the expected rolling-deploy failure for the provider-pool column. */
export function isMissingProviderPoolColumnError(error: unknown): boolean {
  return isMissingWebSearchConfigColumnError(error, "providers");
}

/**
 * Recognize the rolling-deploy window for the calculation switch.
 *
 * New code reaches a database whose migration has not run yet on every rolling
 * deploy. Without this the whole config read rejects, which does not merely
 * disable the calculator: the admin console and deep research read this row
 * strictly and would fail outright, and ordinary search would go fail-closed.
 */
export function isMissingCalculatorColumnError(error: unknown): boolean {
  return isMissingWebSearchConfigColumnError(error, "calculator_enabled");
}

export async function readWebSearchConfigWithLegacyColumnFallback(
  readCurrent: () => Promise<StoredWebSearchConfigRow[]>,
  readBeforeSearchBudget: () => Promise<StoredWebSearchConfigRow[]>,
  readBeforeProviderPool?: () => Promise<StoredWebSearchConfigRow[]>,
  readBeforeDeepResearchBudget?: () => Promise<StoredWebSearchConfigRow[]>,
  readBeforeCalculator?: () => Promise<StoredWebSearchConfigRow[]>,
): Promise<WebSearchConfigRead> {
  const readOldest = async (): Promise<WebSearchConfigRead> => {
    if (!readBeforeProviderPool) throw new Error("provider-pool legacy reader unavailable");
    return {
      rows: await readBeforeProviderPool(),
      usedLegacySearchCallBudget: true,
      usedLegacyDeepResearchBudget: true,
      usedLegacyProviderPool: true,
    };
  };

  const readBeforeSearch = async (): Promise<WebSearchConfigRead> => {
    try {
      return {
        rows: await readBeforeSearchBudget(),
        usedLegacySearchCallBudget: true,
        usedLegacyDeepResearchBudget: true,
        usedLegacyProviderPool: false,
      };
    } catch (error) {
      if (isMissingProviderPoolColumnError(error) && readBeforeProviderPool) {
        return readOldest();
      }
      throw error;
    }
  };

  const handlePreDeepSchemaError = async (error: unknown): Promise<WebSearchConfigRead> => {
    if (isMissingProviderPoolColumnError(error) && readBeforeProviderPool) {
      return readOldest();
    }
    if (!isMissingMaxSearchCallsColumnError(error)) throw error;
    return readBeforeSearch();
  };

  try {
    return {
      rows: await readCurrent(),
      usedLegacySearchCallBudget: false,
      usedLegacyDeepResearchBudget: false,
      usedLegacyProviderPool: false,
    };
  } catch (error) {
    // Only the calculation column is missing: every other value is current, so
    // this is not a legacy schema in any other respect. The retried read omits
    // the column, which leaves it undefined and therefore off.
    if (isMissingCalculatorColumnError(error) && readBeforeCalculator) {
      return {
        rows: await readBeforeCalculator(),
        usedLegacySearchCallBudget: false,
        usedLegacyDeepResearchBudget: false,
        usedLegacyProviderPool: false,
      };
    }
    if (
      isMissingDeepResearchProviderBudgetColumnError(error) &&
      readBeforeDeepResearchBudget
    ) {
      try {
        return {
          rows: await readBeforeDeepResearchBudget(),
          usedLegacySearchCallBudget: false,
          usedLegacyDeepResearchBudget: true,
          usedLegacyProviderPool: false,
        };
      } catch (preDeepError) {
        return handlePreDeepSchemaError(preDeepError);
      }
    }
    try {
      return await handlePreDeepSchemaError(error);
    } catch (fallbackError) {
      throw fallbackError;
    }
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
      apiKey: decryptProviderApiKeyStrict(
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
  usedLegacyDeepResearchBudget = false,
): Exclude<TenantWebSearchRow, null> {
  return {
    enabled: Boolean(row.enabled),
    provider: row.provider,
    apiKey: decryptProviderApiKeyStrict(row.apiKeyCipher ?? ""),
    providers: parseStoredProviders(row.providers),
    maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
    maxSearchCalls: usedLegacySearchCallBudget
      ? DEFAULT_MAX_SEARCH_CALLS
      : normalizeMaxSearchCalls(row.maxSearchCalls),
    maxDeepResearchProviderCalls: usedLegacyDeepResearchBudget
      ? DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS
      : normalizeMaxDeepResearchProviderCalls(row.maxDeepResearchProviderCalls),
    deepResearchEnabled: Boolean(row.deepResearchEnabled),
    // undefined on a legacy-column fallback read, which Boolean() makes false.
    calculatorEnabled: Boolean(row.calculatorEnabled),
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
  return providers.map(({ apiKey, options: _options, ...provider }) => {
    const endpoint = publicProviderEndpoint({ adapter: provider.adapter, options: _options });
    return {
      ...provider,
      hasApiKey: Boolean(apiKey.trim()),
      ...(endpoint ? { endpoint } : {}),
    };
  });
}

function effectivePrimaryProviderId(
  providers: WebSearchProviderConfig[],
  fallback: string,
): string {
  return (
    providers.find(isConfiguredWebSearchProvider)?.id ??
    providers[0]?.id ??
    normalizeProvider(fallback)
  );
}

function normalizeProviderOptions(
  adapterId: string,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  const keys = Object.keys(raw);
  if (keys.some((key) => key !== "endpoint")) {
    throw new WebSearchConfigValidationError("搜索服务包含不支持的配置项");
  }
  const endpoint = raw.endpoint;
  if (endpoint === undefined || endpoint === "") return undefined;
  const adapter = getWebSearchAdapter(adapterId);
  if (!adapter?.supportsCustomEndpoint) {
    throw new WebSearchConfigValidationError("所选搜索协议不支持自定义 API 地址");
  }
  // publicProviderEndpoint runs the shared HTTPS/internal-target syntax policy.
  const normalized = publicProviderEndpoint({ adapter: adapterId, options: { endpoint } });
  if (!normalized) {
    throw new WebSearchConfigValidationError("搜索服务 API 地址无效");
  }
  return { endpoint: normalized };
}

function normalizeProviderUpdates(
  updates: WebSearchProviderUpdate[],
  existing: WebSearchProviderConfig[],
): WebSearchProviderConfig[] {
  if (updates.length < 1 || updates.length > MAX_CONFIGURED_WEB_SEARCH_PROVIDERS) {
    throw new WebSearchConfigValidationError(
      `搜索服务数量必须为 1 到 ${MAX_CONFIGURED_WEB_SEARCH_PROVIDERS} 个`,
    );
  }
  const existingById = new Map(existing.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const providers: WebSearchProviderConfig[] = [];
  for (const update of updates) {
    const id = typeof update?.id === "string" ? update.id.trim() : "";
    const adapter =
      typeof update?.adapter === "string" ? normalizeProvider(update.adapter) : "";
    if (
      !id ||
      id.length > MAX_PROVIDER_ID_CHARS ||
      !PROVIDER_ID_RE.test(id) ||
      !adapter ||
      !getWebSearchAdapter(adapter)
    ) {
      throw new WebSearchConfigValidationError("搜索服务 ID 或接口协议无效");
    }
    if (seen.has(id)) {
      throw new WebSearchConfigValidationError("搜索服务 ID 不能重复");
    }
    seen.add(id);
    const previous = existingById.get(id);
    const adapterChanged = Boolean(previous && previous.adapter !== adapter);
    const displayName = update.displayName?.trim() || previous?.displayName || id;
    if (displayName.length > MAX_PROVIDER_DISPLAY_NAME_CHARS) {
      throw new WebSearchConfigValidationError("搜索服务名称过长");
    }
    if (
      update.apiKey !== undefined &&
      (update.apiKey.length > MAX_PROVIDER_API_KEY_CHARS || /[\r\n]/.test(update.apiKey))
    ) {
      throw new WebSearchConfigValidationError("搜索服务 API Key 格式无效或过长");
    }
    const submittedOptions = asOptions(update.options);
    if (update.options !== undefined && !submittedOptions) {
      throw new WebSearchConfigValidationError("搜索服务配置格式无效");
    }
    const nextOptions =
      update.options !== undefined
        ? normalizeProviderOptions(adapter, submittedOptions)
        : adapterChanged
          ? undefined
          : previous?.options;
    const endpointChanged = Boolean(
      previous &&
        publicProviderEndpoint(previous) !==
          publicProviderEndpoint({ adapter, options: nextOptions }),
    );
    providers.push({
      id,
      adapter,
      displayName,
      // Never forward one protocol's credential to another when an id is reused.
      apiKey:
        update.apiKey === undefined
          ? adapterChanged || endpointChanged
            ? ""
            : previous?.apiKey ?? ""
          : update.apiKey,
      enabled: update.enabled ?? previous?.enabled ?? true,
      priority:
        typeof update.priority === "number" && Number.isFinite(update.priority)
          ? update.priority
          : providers.length,
      options: nextOptions,
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
    const {
      rows,
      usedLegacySearchCallBudget,
      usedLegacyDeepResearchBudget,
      usedLegacyProviderPool,
    } =
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
        () =>
          db
            .select({
              enabled: mysqlTable.enabled,
              provider: mysqlTable.provider,
              apiKeyCipher: mysqlTable.apiKeyCipher,
              maxResults: mysqlTable.maxResults,
              deepResearchEnabled: mysqlTable.deepResearchEnabled,
            })
            .from(mysqlTable)
            .where(eq(mysqlTable.tenantId, tid))
            .limit(1),
        () =>
          db
            .select({
              enabled: mysqlTable.enabled,
              provider: mysqlTable.provider,
              apiKeyCipher: mysqlTable.apiKeyCipher,
              providers: mysqlTable.providers,
              maxResults: mysqlTable.maxResults,
              maxSearchCalls: mysqlTable.maxSearchCalls,
              deepResearchEnabled: mysqlTable.deepResearchEnabled,
            })
            .from(mysqlTable)
            .where(eq(mysqlTable.tenantId, tid))
            .limit(1),
        // Everything current except the calculation switch, for the window
        // between deploying this code and running its migration.
        () =>
          db
            .select({
              enabled: mysqlTable.enabled,
              provider: mysqlTable.provider,
              apiKeyCipher: mysqlTable.apiKeyCipher,
              providers: mysqlTable.providers,
              maxResults: mysqlTable.maxResults,
              maxSearchCalls: mysqlTable.maxSearchCalls,
              maxDeepResearchProviderCalls: mysqlTable.maxDeepResearchProviderCalls,
              deepResearchEnabled: mysqlTable.deepResearchEnabled,
            })
            .from(mysqlTable)
            .where(eq(mysqlTable.tenantId, tid))
            .limit(1),
      );
    const row = rows[0];
    if (!row) return null;
    return mapStoredWebSearchConfigRow(
      row,
      usedLegacySearchCallBudget || usedLegacyProviderPool,
      usedLegacyDeepResearchBudget || usedLegacyProviderPool,
    );
  }

  const db = getIamDb();
  const {
    rows,
    usedLegacySearchCallBudget,
    usedLegacyDeepResearchBudget,
    usedLegacyProviderPool,
  } =
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
      () =>
        db
          .select({
            enabled: pgTable.enabled,
            provider: pgTable.provider,
            apiKeyCipher: pgTable.apiKeyCipher,
            maxResults: pgTable.maxResults,
            deepResearchEnabled: pgTable.deepResearchEnabled,
          })
          .from(pgTable)
          .where(eq(pgTable.tenantId, tid))
          .limit(1),
      () =>
        db
          .select({
            enabled: pgTable.enabled,
            provider: pgTable.provider,
            apiKeyCipher: pgTable.apiKeyCipher,
            providers: pgTable.providers,
            maxResults: pgTable.maxResults,
            maxSearchCalls: pgTable.maxSearchCalls,
            deepResearchEnabled: pgTable.deepResearchEnabled,
          })
          .from(pgTable)
          .where(eq(pgTable.tenantId, tid))
          .limit(1),
      // Everything current except the calculation switch, for the window
      // between deploying this code and running its migration.
      () =>
        db
          .select({
            enabled: pgTable.enabled,
            provider: pgTable.provider,
            apiKeyCipher: pgTable.apiKeyCipher,
            providers: pgTable.providers,
            maxResults: pgTable.maxResults,
            maxSearchCalls: pgTable.maxSearchCalls,
            maxDeepResearchProviderCalls: pgTable.maxDeepResearchProviderCalls,
            deepResearchEnabled: pgTable.deepResearchEnabled,
          })
          .from(pgTable)
          .where(eq(pgTable.tenantId, tid))
          .limit(1),
    );
  const row = rows[0];
  if (!row) return null;
  return mapStoredWebSearchConfigRow(
    row,
    usedLegacySearchCallBudget || usedLegacyProviderPool,
    usedLegacyDeepResearchBudget || usedLegacyProviderPool,
  );
}

/** Ordinary-search runtime read; storage/decryption failures disable outbound search. */
export async function loadTenantWebSearchConfig(tenantId: string): Promise<TenantWebSearchRow> {
  try {
    return await loadTenantWebSearchConfigStrict(tenantId);
  } catch (error) {
    console.error(
      "[web-search] tenant config unavailable; disabling outbound search:",
      error instanceof Error ? error.message : error,
    );
    return {
      enabled: false,
      provider: "duckduckgo",
      apiKey: "",
      providers: [],
      maxResults: DEFAULT_MAX_RESULTS,
      maxSearchCalls: DEFAULT_MAX_SEARCH_CALLS,
      maxDeepResearchProviderCalls: DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
      deepResearchEnabled: false,
      calculatorEnabled: false,
    };
  }
}

/**
 * The tenant's calculation switch, resolved for a row that may not exist.
 *
 * Four inputs, one rule each:
 * - no row at all — no tenant policy is on record, whether because the tenant
 *   has never opened the settings page or because this deployment has no
 *   database configured. Both keep the column default, so calculation is ON;
 * - the column is present and false — an administrator turned it off;
 * - the column is missing, so a legacy-column fallback read produced undefined
 *   — a schema we cannot confirm reads as OFF;
 * - the config load failed, so the caller holds the fail-closed row, which
 *   carries false for the same reason.
 *
 * Read through this everywhere. Repeating `?? true` at call sites is how the
 * missing-column case quietly becomes on again.
 */
export function isCalculatorEnabled(row: TenantWebSearchRow): boolean {
  if (!row) return true;
  return Boolean(row.calculatorEnabled);
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
      maxDeepResearchProviderCalls: DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
      hasApiKey: false,
      deepResearchEnabled: true,
      calculatorEnabled: true,
      primaryProviderId: "duckduckgo",
      providers: [],
      availableAdapters: listWebSearchAdapters(),
    };
  }
  return {
    enabled: row.enabled,
    provider: normalizeProvider(row.provider),
    maxResults: row.maxResults,
    maxSearchCalls: normalizeMaxSearchCalls(row.maxSearchCalls),
    maxDeepResearchProviderCalls: normalizeMaxDeepResearchProviderCalls(
      row.maxDeepResearchProviderCalls,
    ),
    hasApiKey: Boolean(row.apiKey.trim()),
    deepResearchEnabled: Boolean(row.deepResearchEnabled),
    calculatorEnabled: isCalculatorEnabled(row),
    primaryProviderId: effectivePrimaryProviderId(
      row.providers ?? [],
      row.provider,
    ),
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
    const selectedId = input.provider.trim();
    const selectedAdapter = normalizeProvider(input.provider);
    const index = nextProviders.findIndex(
      (provider) => provider.id === selectedId || provider.adapter === selectedAdapter,
    );
    if (index < 0 && !getWebSearchAdapter(selectedAdapter)) {
      throw new WebSearchConfigValidationError("所选搜索服务不存在");
    }
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
  const nextMaxDeepResearchProviderCalls = normalizeMaxDeepResearchProviderCalls(
    input.maxDeepResearchProviderCalls ?? existing?.maxDeepResearchProviderCalls,
  );
  const nextDeepResearch =
    input.deepResearchEnabled ?? existing?.deepResearchEnabled ?? true;
  // A tenant that has never opened this page keeps calculation on, matching the
  // column default. Only an administrator turning it off writes false.
  const nextCalculator =
    input.calculatorEnabled ?? existing?.calculatorEnabled ?? true;
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
        maxDeepResearchProviderCalls: nextMaxDeepResearchProviderCalls,
        deepResearchEnabled: nextDeepResearch,
        calculatorEnabled: nextCalculator,
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
          maxDeepResearchProviderCalls: nextMaxDeepResearchProviderCalls,
          deepResearchEnabled: nextDeepResearch,
          calculatorEnabled: nextCalculator,
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
        maxDeepResearchProviderCalls: nextMaxDeepResearchProviderCalls,
        deepResearchEnabled: nextDeepResearch,
        calculatorEnabled: nextCalculator,
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
          maxDeepResearchProviderCalls: nextMaxDeepResearchProviderCalls,
          deepResearchEnabled: nextDeepResearch,
          calculatorEnabled: nextCalculator,
          updatedAt,
        },
      });
  }

  return {
    enabled: nextEnabled,
    provider: nextProvider,
    maxResults: nextMax,
    maxSearchCalls: nextMaxSearchCalls,
    maxDeepResearchProviderCalls: nextMaxDeepResearchProviderCalls,
    hasApiKey: Boolean(nextKey.trim()),
    deepResearchEnabled: nextDeepResearch,
    calculatorEnabled: nextCalculator,
    primaryProviderId: effectivePrimaryProviderId(nextProviders, primary.id),
    providers: publicProviders(nextProviders),
    availableAdapters: listWebSearchAdapters(),
  };
}
