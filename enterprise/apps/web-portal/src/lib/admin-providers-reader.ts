/**
 * web-portal · 只读：从运行时配置表读取 admin 配置的 provider 与用户可见模型。
 * 支持 PostgreSQL / MySQL（DATABASE_DIALECT）。
 */

import { enterpriseRuntimeModelProviders as pgMpTable } from "@agenticx/db-schema";
import { enterpriseRuntimeUserVisibleModels as pgUvmTable } from "@agenticx/db-schema";
import {
  enterpriseRuntimeModelProviders as mysqlMpTable,
  enterpriseRuntimeUserVisibleModels as mysqlUvmTable,
} from "@agenticx/db-schema/mysql";
import {
  createMysqlDb,
  getIamDb,
  listDepartmentAncestorIds,
  migrateLegacyUserVisibleModelsIfNeeded,
  resolveDatabaseConfig,
} from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

import {
  collectUserAssignmentKeys,
  computeEffectiveDeptAllowed,
  computeEffectiveUserAllowed,
  mergeUserStoredSet,
} from "./effective-models";
import { decryptProviderApiKey } from "./provider-api-key-crypto";

export type ProviderRoute = "local" | "private-cloud" | "third-party";

export interface ProviderModelRecord {
  name: string;
  label: string;
  enabled: boolean;
  capabilities?: string[];
}

export interface ProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  route: ProviderRoute;
  models: ProviderModelRecord[];
}

export interface PortalModelOption {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  route: ProviderRoute;
  isDefault: boolean;
  capabilities?: string[];
}

const LEGACY_ADMIN_EMAIL_TO_USER_ID: Record<string, string> = {
  "admin@agenticx.local": "u_001",
  "owner@agenticx.local": "u_001",
  "ops@agenticx.local": "u_002",
  "audit@agenticx.local": "u_003",
};

type ProviderRow = {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKeyCipher: string;
  enabled: boolean;
  isDefault: boolean;
  route: string;
  models: unknown;
};

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required.");
  return t;
}

function rowToProvider(row: ProviderRow): ProviderRecord {
  const modelsRaw = Array.isArray(row.models) ? (row.models as unknown as ProviderModelRecord[]) : [];
  return {
    id: row.providerId,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    apiKey: decryptProviderApiKey(row.apiKeyCipher),
    enabled: row.enabled,
    isDefault: row.isDefault,
    route: row.route as ProviderRoute,
    models: modelsRaw.map((m) => ({
      name: m.name,
      label: m.label ?? m.name,
      enabled: m.enabled,
      capabilities: m.capabilities,
    })),
  };
}

async function readProviders(): Promise<ProviderRecord[]> {
  const tid = requiredTenant();
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    const rows = await db.select().from(mysqlMpTable).where(eq(mysqlMpTable.tenantId, tid));
    return rows.map(rowToProvider);
  }
  const db = getIamDb();
  const rows = await db.select().from(pgMpTable).where(eq(pgMpTable.tenantId, tid));
  return rows.map(rowToProvider);
}

async function readUserModels(): Promise<Record<string, string[]>> {
  const tid = requiredTenant();
  await migrateLegacyUserVisibleModelsIfNeeded(tid);
  const config = resolveDatabaseConfig();
  let rows: Array<{ assignmentKey: string; modelId: string }>;
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    rows = await db.select().from(mysqlUvmTable).where(eq(mysqlUvmTable.tenantId, tid));
  } else {
    const db = getIamDb();
    rows = await db.select().from(pgUvmTable).where(eq(pgUvmTable.tenantId, tid));
  }
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!map[r.assignmentKey]) map[r.assignmentKey] = [];
    map[r.assignmentKey]!.push(r.modelId);
  }
  for (const k of Object.keys(map)) {
    map[k] = [...new Set(map[k]!)];
  }
  return map;
}

function flattenEnabledModelIds(providers: ProviderRecord[]): string[] {
  const ids: string[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      ids.push(`${p.id}/${m.name}`);
    }
  }
  return ids;
}

function resolveUserKeys(userId: string, email?: string): string[] {
  const keys = collectUserAssignmentKeys(userId, email);
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    const legacyUserId = LEGACY_ADMIN_EMAIL_TO_USER_ID[normalizedEmail];
    if (legacyUserId && !keys.includes(legacyUserId)) keys.push(legacyUserId);
  }
  return keys;
}

/** 当前用户最终可见模型 = 启用的 provider × model，经部门/用户级联收窄。 */
export async function listAvailableModelsForUser(
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<PortalModelOption[]> {
  const providers = await readProviders();
  const userMap = await readUserModels();
  const allEnabled = flattenEnabledModelIds(providers);

  let deptEffective = allEnabled;
  if (deptId) {
    const tid = requiredTenant();
    const chain = await listDepartmentAncestorIds(tid, deptId);
    deptEffective = computeEffectiveDeptAllowed({
      allEnabledIds: allEnabled,
      userVisibleMap: userMap,
      ancestorChain: chain,
    });
  }

  const userKeys = resolveUserKeys(userId, email);
  const userStored = mergeUserStoredSet(userMap, userKeys);
  const effectiveIds = new Set(computeEffectiveUserAllowed(deptEffective, userStored));

  const out: PortalModelOption[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      const id = `${p.id}/${m.name}`;
      if (!effectiveIds.has(id)) continue;
      out.push({
        id,
        provider: p.id,
        providerLabel: p.displayName,
        model: m.name,
        label: m.label,
        route: p.route,
        isDefault: p.isDefault,
        capabilities: m.capabilities,
      });
    }
  }
  return out;
}
