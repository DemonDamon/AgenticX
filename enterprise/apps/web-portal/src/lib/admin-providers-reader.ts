/**
 * web-portal · 只读：从 Postgres 读取 admin 配置的 provider 与用户可见模型。
 */

import { enterpriseRuntimeModelProviders as mpTable } from "@agenticx/db-schema";
import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

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
}

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required.");
  return t;
}

function rowToProvider(row: typeof mpTable.$inferSelect): ProviderRecord {
  const modelsRaw = Array.isArray(row.models) ? (row.models as ProviderModelRecord[]) : [];
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
  const db = getIamDb();
  const rows = await db.select().from(mpTable).where(eq(mpTable.tenantId, tid));
  return rows.map(rowToProvider);
}

async function readUserModels(): Promise<Record<string, string[]>> {
  const tid = requiredTenant();
  const db = getIamDb();
  const rows = await db.select().from(uvmTable).where(eq(uvmTable.tenantId, tid));
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!map[r.assignmentKey]) map[r.assignmentKey] = [];
    map[r.assignmentKey]!.push(r.modelId);
  }
  return map;
}

const LEGACY_ADMIN_EMAIL_TO_USER_ID: Record<string, string> = {
  "admin@agenticx.local": "u_001",
  "owner@agenticx.local": "u_001",
  "ops@agenticx.local": "u_002",
  "audit@agenticx.local": "u_003",
};

function resolveAssignmentKeys(userId: string, email?: string): string[] {
  const keys = new Set<string>();
  if (userId) keys.add(userId);
  if (!email) return Array.from(keys);
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return Array.from(keys);

  keys.add(`email:${normalizedEmail}`);

  const legacyUserId = LEGACY_ADMIN_EMAIL_TO_USER_ID[normalizedEmail];
  if (legacyUserId) keys.add(legacyUserId);

  return Array.from(keys);
}

/** 当前用户最终可见模型 = （启用的 provider × model）∩ 管理员分配集合。 */
export async function listAvailableModelsForUser(userId: string, email?: string): Promise<PortalModelOption[]> {
  const providers = await readProviders();
  const userMap = await readUserModels();
  const allowed = new Set<string>();
  for (const key of resolveAssignmentKeys(userId, email)) {
    for (const modelId of userMap[key] ?? []) {
      if (modelId) allowed.add(modelId);
    }
  }
  const out: PortalModelOption[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      const id = `${p.id}/${m.name}`;
      if (!allowed.has(id)) continue;
      out.push({
        id,
        provider: p.id,
        providerLabel: p.displayName,
        model: m.name,
        label: m.label,
        route: p.route,
        isDefault: p.isDefault,
      });
    }
  }
  return out;
}
