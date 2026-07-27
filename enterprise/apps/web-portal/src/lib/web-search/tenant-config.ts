/**
 * Load / upsert tenant web-search config from PG or MySQL.
 */

import { enterpriseRuntimeWebSearch as pgTable } from "@agenticx/db-schema";
import { enterpriseRuntimeWebSearch as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { decryptProviderApiKey, encryptProviderApiKey } from "@agenticx/iam-core/provider-api-key-crypto";
import { eq } from "drizzle-orm";

import type { TenantWebSearchRow } from "./config";
import { DEFAULT_MAX_RESULTS, type WebSearchProviderName } from "./providers";

export type WebSearchPublicConfig = {
  enabled: boolean;
  provider: WebSearchProviderName;
  maxResults: number;
  hasApiKey: boolean;
};

export type WebSearchUpdateInput = {
  enabled?: boolean;
  provider?: string;
  maxResults?: number;
  /** Empty string clears key; undefined leaves unchanged. */
  apiKey?: string;
};

function normalizeProvider(raw: string | undefined): WebSearchProviderName {
  const value = (raw ?? "duckduckgo").trim().toLowerCase();
  if (value === "bocha" || value === "tavily" || value === "duckduckgo") return value;
  return "duckduckgo";
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
        maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
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
      maxResults: Number(row.maxResults) || DEFAULT_MAX_RESULTS,
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
    };
  }
  return {
    enabled: row.enabled,
    provider: normalizeProvider(row.provider),
    maxResults: row.maxResults,
    hasApiKey: Boolean(row.apiKey.trim()),
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
  const nextProvider = normalizeProvider(input.provider ?? existing?.provider ?? "duckduckgo");
  const nextMax = input.maxResults ?? existing?.maxResults ?? DEFAULT_MAX_RESULTS;
  let nextKey = existing?.apiKey ?? "";
  if (input.apiKey !== undefined) {
    nextKey = input.apiKey;
  }
  const cipher = encryptProviderApiKey(nextKey);
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
        maxResults: nextMax,
        updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: nextEnabled,
          provider: nextProvider,
          apiKeyCipher: cipher,
          maxResults: nextMax,
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
        maxResults: nextMax,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: pgTable.tenantId,
        set: {
          enabled: nextEnabled,
          provider: nextProvider,
          apiKeyCipher: cipher,
          maxResults: nextMax,
          updatedAt,
        },
      });
  }

  return {
    enabled: nextEnabled,
    provider: nextProvider,
    maxResults: nextMax,
    hasApiKey: Boolean(nextKey.trim()),
  };
}
