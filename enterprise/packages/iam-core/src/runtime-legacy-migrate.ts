/**
 * 将 enterprise/.runtime/admin/*.json 一次性导入 Postgres 运行时表。
 * admin-console / web-portal / CLI 共用，避免「只有某一端触发了 lazy migration」导致数据断层。
 */

import {
  enterpriseRuntimeModelProviders as mpTable,
  enterpriseRuntimeTokenQuotas as qTable,
  enterpriseRuntimeUserVisibleModels as uvmTable,
} from "@agenticx/db-schema";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

import { getIamDb } from "./db";
import { encryptProviderApiKey } from "./provider-api-key-crypto";

export type MigrateSliceResult = {
  action: "imported" | "skipped";
  count: number;
  reason?: string;
};

export type RuntimeLegacyMigrateResult = {
  runtimeDir: string;
  tenantId: string;
  providers: MigrateSliceResult;
  userVisibleModels: MigrateSliceResult;
  quotas: MigrateSliceResult;
};

type ProviderLegacyRecord = {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
  route?: string;
  envKey?: string;
  models?: Array<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
};

export type QuotaAction = "block" | "warn" | "fallback";

export type QuotaRule = {
  monthlyTokens: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  action: QuotaAction;
};

export type QuotaConfig = {
  defaults: {
    role: Record<string, QuotaRule>;
    model: Record<string, QuotaRule>;
  };
  users: Record<string, QuotaRule>;
  departments: Record<string, QuotaRule>;
  apiTokens?: Record<string, QuotaRule>;
  updatedAt: string;
};

export function resolveRuntimeAdminDir(cwd = process.cwd()): string {
  const fromEnv = process.env.ENTERPRISE_ADMIN_RUNTIME_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.resolve(cwd, ".runtime/admin"),
    path.resolve(cwd, "../../.runtime/admin"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function requiredTenant(explicit?: string): string {
  const t = (explicit ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for runtime legacy migration.");
  return t;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeRule(input: Partial<QuotaRule> | undefined): QuotaRule {
  const monthlyTokens = Number(input?.monthlyTokens ?? 0);
  const action = input?.action ?? "warn";
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    action: action === "block" || action === "fallback" ? action : "warn",
  };
}

function normalizeQuota(input: Partial<QuotaConfig> | undefined): QuotaConfig {
  const next: QuotaConfig = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    updatedAt: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(input?.defaults?.role ?? {})) {
    next.defaults.role[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.defaults?.model ?? {})) {
    next.defaults.model[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.users ?? {})) {
    next.users[key] = normalizeRule(value);
  }
  for (const [key, value] of Object.entries(input?.departments ?? {})) {
    next.departments[key] = normalizeRule(value);
  }
  return next;
}

/** 模型服务商：PG 无行时从 providers.json 导入。 */
export async function migrateLegacyProvidersIfNeeded(
  tenantId: string,
  runtimeDir = resolveRuntimeAdminDir()
): Promise<MigrateSliceResult> {
  const db = getIamDb();
  const existing = await db
    .select({ id: mpTable.id })
    .from(mpTable)
    .where(eq(mpTable.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) {
    return { action: "skipped", count: 0, reason: "postgres already has providers" };
  }

  const legacyFile = path.join(runtimeDir, "providers.json");
  if (!fs.existsSync(legacyFile)) {
    return { action: "skipped", count: 0, reason: "providers.json not found" };
  }

  const parsed = readJsonFile<{ providers?: ProviderLegacyRecord[] }>(legacyFile, {});
  const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
  if (providers.length === 0) {
    return { action: "skipped", count: 0, reason: "providers.json empty" };
  }

  const now = new Date().toISOString();
  for (const p of providers) {
    await db.insert(mpTable).values({
      id: ulid(),
      tenantId,
      providerId: p.id,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      apiKeyCipher: encryptProviderApiKey(p.apiKey ?? ""),
      enabled: p.enabled ?? true,
      isDefault: p.isDefault ?? false,
      route: p.route ?? "third-party",
      envKey: p.envKey ?? null,
      models: (p.models ?? []) as Record<string, unknown>[],
      createdAt: new Date(p.createdAt || now),
      updatedAt: new Date(p.updatedAt || now),
    });
  }

  return { action: "imported", count: providers.length };
}

/** 用户可见模型：PG 无行时从 user-models.json 导入。 */
export async function migrateLegacyUserVisibleModelsIfNeeded(
  tenantId: string,
  runtimeDir = resolveRuntimeAdminDir()
): Promise<MigrateSliceResult> {
  const db = getIamDb();
  const existing = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(eq(uvmTable.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) {
    return { action: "skipped", count: 0, reason: "postgres already has user visible models" };
  }

  const legacyFile = path.join(runtimeDir, "user-models.json");
  if (!fs.existsSync(legacyFile)) {
    return { action: "skipped", count: 0, reason: "user-models.json not found" };
  }

  const parsed = readJsonFile<{ userModels?: Record<string, string[]> }>(legacyFile, {});
  const userModels = parsed.userModels ?? {};
  const rows = Object.entries(userModels).flatMap(([assignmentKey, modelIds]) =>
    (modelIds ?? [])
      .filter(Boolean)
      .map((modelId) => ({
        tenantId,
        assignmentKey,
        modelId: modelId.trim(),
      }))
  );
  if (rows.length === 0) {
    return { action: "skipped", count: 0, reason: "user-models.json empty" };
  }

  for (const chunk of chunked(rows, 200)) {
    await db.insert(uvmTable).values(chunk).onConflictDoNothing();
  }

  return { action: "imported", count: rows.length };
}

/** Token 配额：PG 无行时从 quotas.json 导入。 */
export async function migrateLegacyQuotasIfNeeded(
  tenantId: string,
  runtimeDir = resolveRuntimeAdminDir()
): Promise<MigrateSliceResult> {
  const db = getIamDb();
  const existing = await db.select().from(qTable).where(eq(qTable.tenantId, tenantId)).limit(1);
  if (existing.length > 0) {
    return { action: "skipped", count: 0, reason: "postgres already has quota config" };
  }

  const legacyFile =
    process.env.ENTERPRISE_QUOTA_CONFIG_FILE?.trim() || path.join(runtimeDir, "quotas.json");
  if (!fs.existsSync(legacyFile)) {
    return { action: "skipped", count: 0, reason: "quotas.json not found" };
  }

  const parsed = readJsonFile<Partial<QuotaConfig>>(legacyFile, {});
  const cfg = normalizeQuota(parsed);
  await db.insert(qTable).values({
    tenantId,
    config: cfg as unknown as Record<string, unknown>,
    updatedAt: new Date(cfg.updatedAt),
  });

  return { action: "imported", count: 1 };
}

/** 按 providers → user-models → quotas 顺序执行 legacy 导入（幂等）。 */
export async function migrateRuntimeLegacyFromDisk(options?: {
  tenantId?: string;
  runtimeDir?: string;
  cwd?: string;
}): Promise<RuntimeLegacyMigrateResult> {
  const tenantId = requiredTenant(options?.tenantId);
  const runtimeDir = options?.runtimeDir ?? resolveRuntimeAdminDir(options?.cwd ?? process.cwd());

  const providers = await migrateLegacyProvidersIfNeeded(tenantId, runtimeDir);
  const userVisibleModels = await migrateLegacyUserVisibleModelsIfNeeded(tenantId, runtimeDir);
  const quotas = await migrateLegacyQuotasIfNeeded(tenantId, runtimeDir);

  return {
    runtimeDir,
    tenantId,
    providers,
    userVisibleModels,
    quotas,
  };
}
