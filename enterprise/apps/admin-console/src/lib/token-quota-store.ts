import { enterpriseRuntimeTokenQuotas as qTable } from "@agenticx/db-schema";
import { getIamDb, migrateLegacyQuotasIfNeeded, resolveRuntimeAdminDir, type QuotaConfig as SharedQuotaConfig } from "@agenticx/iam-core";
import * as path from "node:path";
import { eq } from "drizzle-orm";

export type QuotaAction = "block" | "warn" | "fallback";

export type QuotaRule = {
  monthlyTokens: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  action: QuotaAction;
};

export type QuotaConfig = SharedQuotaConfig & {
  apiTokens?: Record<string, QuotaRule>;
};

const LEGACY_FILE = path.join(resolveRuntimeAdminDir(), "quotas.json");

const DEFAULT_CONFIG: QuotaConfig = {
  defaults: {
    role: {
      admin: { monthlyTokens: 1_500_000, action: "warn" },
      staff: { monthlyTokens: 600_000, action: "warn" },
      guest: { monthlyTokens: 300_000, action: "block" },
    },
    model: {},
  },
  users: {},
  departments: {},
  updatedAt: new Date().toISOString(),
};

let legacyRan = false;

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for quota config.");
  return t;
}

function normalizeRule(input: Partial<QuotaRule> | undefined): QuotaRule {
  const monthlyTokens = Number(input?.monthlyTokens ?? 0);
  const tpm = Number(input?.tpm ?? 0);
  const rpm = Number(input?.rpm ?? 0);
  const maxConcurrency = Number(input?.maxConcurrency ?? 0);
  const action = input?.action ?? "warn";
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    tpm: Number.isFinite(tpm) && tpm > 0 ? Math.floor(tpm) : 0,
    rpm: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0,
    maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? Math.floor(maxConcurrency) : 0,
    action: action === "block" || action === "fallback" ? action : "warn",
  };
}

function normalizeQuota(input: Partial<QuotaConfig> | undefined): QuotaConfig {
  const next: QuotaConfig = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    apiTokens: {},
    updatedAt: new Date().toISOString(),
  };
  const roles = input?.defaults?.role ?? {};
  for (const [key, value] of Object.entries(roles)) next.defaults.role[key] = normalizeRule(value);
  const models = input?.defaults?.model ?? {};
  for (const [key, value] of Object.entries(models)) next.defaults.model[key] = normalizeRule(value);
  const users = input?.users ?? {};
  for (const [key, value] of Object.entries(users)) next.users[key] = normalizeRule(value);
  const depts = input?.departments ?? {};
  for (const [key, value] of Object.entries(depts)) next.departments[key] = normalizeRule(value);
  const apiTokens = input?.apiTokens ?? {};
  for (const [key, value] of Object.entries(apiTokens)) next.apiTokens![key] = normalizeRule(value);
  return next;
}

function configFromRow(payload: Record<string, unknown> | undefined | null): QuotaConfig | null {
  if (!payload || typeof payload !== "object") return null;
  return normalizeQuota(payload as Partial<QuotaConfig>);
}

async function migrateLegacyQuotasOnce(tid: string): Promise<void> {
  if (legacyRan) return;
  legacyRan = true;
  await migrateLegacyQuotasIfNeeded(tid);
}

/** 租户 token 配额整包读取。 */
export async function getQuotaConfig(): Promise<QuotaConfig> {
  const tid = tenant();
  await migrateLegacyQuotasOnce(tid);
  const db = getIamDb();
  const row = await db.select().from(qTable).where(eq(qTable.tenantId, tid)).limit(1);
  if (!row.length) {
    /** 尚无记录时写入默认模板并返回（等同旧 json 首次自动生成）。 */
    const seed = normalizeQuota(DEFAULT_CONFIG);
    await db
      .insert(qTable)
      .values({
        tenantId: tid,
        config: seed as unknown as Record<string, unknown>,
        updatedAt: new Date(seed.updatedAt),
      })
      .onConflictDoNothing();
    return seed;
  }
  const parsed = configFromRow(row[0]?.config as Record<string, unknown>);
  return parsed ?? normalizeQuota(DEFAULT_CONFIG);
}

export async function setQuotaConfig(input: Partial<QuotaConfig>): Promise<QuotaConfig> {
  const tid = tenant();
  await migrateLegacyQuotasOnce(tid);
  const next = normalizeQuota(input);
  next.updatedAt = new Date().toISOString();
  const db = getIamDb();
  await db
    .insert(qTable)
    .values({
      tenantId: tid,
      config: next as unknown as Record<string, unknown>,
      updatedAt: new Date(next.updatedAt),
    })
    .onConflictDoUpdate({
      target: qTable.tenantId,
      set: {
        config: next as unknown as Record<string, unknown>,
        updatedAt: new Date(next.updatedAt),
      },
    });
  return next;
}

export function quotaFilePath(): string {
  return LEGACY_FILE;
}
