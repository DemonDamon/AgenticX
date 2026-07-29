import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeTokenQuotas as qTable } from "@agenticx/db-schema/mysql";
import { migrateLegacyQuotasIfNeeded, resolveRuntimeAdminDir, type QuotaConfig as SharedQuotaConfig } from "@agenticx/iam-core";
import * as path from "node:path";
import { eq } from "drizzle-orm";

export type QuotaAction = "block" | "warn" | "fallback";

export type QuotaRule = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  requestsPerDay?: number;
  requestsPerWeek?: number;
  requestsPerMonth?: number;
  poolScope?: "" | "dept" | "tenant";
  action: QuotaAction;
};

/** 用户组是批量管理成员的模板，不参与网关的共享额度计算。 */
export type UserGroup = {
  name: string;
  description?: string;
  memberIds: string[];
  /** 保存时写入每位成员的个人月额度；0 表示不限制。 */
  monthlyTokens: number;
  /** 保存时批量下发到成员的可用模型；空数组表示不改成员现有模型范围。 */
  modelIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type QuotaConfig = SharedQuotaConfig & {
  apiTokens?: Record<string, QuotaRule>;
  groups?: Record<string, UserGroup>;
};

const LEGACY_FILE = path.join(resolveRuntimeAdminDir(), "quotas.json");

const DEFAULT_CONFIG: QuotaConfig = {
  defaults: {
    role: {
      admin: { monthlyTokens: 1_500_000, action: "block" },
      staff: { monthlyTokens: 600_000, action: "block" },
      guest: { monthlyTokens: 300_000, action: "block" },
    },
    model: {},
  },
  users: {},
  departments: {},
  groups: {},
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
  const dailyTokens = Number(input?.dailyTokens ?? 0);
  const weeklyTokens = Number(input?.weeklyTokens ?? 0);
  const tpm = Number(input?.tpm ?? 0);
  const rpm = Number(input?.rpm ?? 0);
  const maxConcurrency = Number(input?.maxConcurrency ?? 0);
  const requestsPerDay = Number(input?.requestsPerDay ?? 0);
  const requestsPerWeek = Number(input?.requestsPerWeek ?? 0);
  const requestsPerMonth = Number(input?.requestsPerMonth ?? 0);
  const action = input?.action ?? "warn";
  const poolScopeRaw = String(input?.poolScope ?? "").trim();
  const poolScope = poolScopeRaw === "dept" || poolScopeRaw === "tenant" ? poolScopeRaw : ("" as const);
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    dailyTokens: Number.isFinite(dailyTokens) && dailyTokens > 0 ? Math.floor(dailyTokens) : 0,
    weeklyTokens: Number.isFinite(weeklyTokens) && weeklyTokens > 0 ? Math.floor(weeklyTokens) : 0,
    tpm: Number.isFinite(tpm) && tpm > 0 ? Math.floor(tpm) : 0,
    rpm: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0,
    maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? Math.floor(maxConcurrency) : 0,
    requestsPerDay: Number.isFinite(requestsPerDay) && requestsPerDay > 0 ? Math.floor(requestsPerDay) : 0,
    requestsPerWeek: Number.isFinite(requestsPerWeek) && requestsPerWeek > 0 ? Math.floor(requestsPerWeek) : 0,
    requestsPerMonth: Number.isFinite(requestsPerMonth) && requestsPerMonth > 0 ? Math.floor(requestsPerMonth) : 0,
    poolScope,
    action: action === "block" || action === "fallback" ? action : "warn",
  };
}

function normalizeGroup(input: Partial<UserGroup> | undefined): UserGroup {
  const now = new Date().toISOString();
  const memberIds = Array.isArray(input?.memberIds)
    ? [...new Set(input.memberIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  const modelIds = Array.isArray(input?.modelIds)
    ? [...new Set(input.modelIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  const monthlyTokens = Number(input?.monthlyTokens ?? 0);
  return {
    name: String(input?.name ?? "").trim() || "未命名用户组",
    ...(description ? { description } : {}),
    memberIds,
    modelIds,
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    createdAt: typeof input?.createdAt === "string" && input.createdAt ? input.createdAt : now,
    updatedAt: typeof input?.updatedAt === "string" && input.updatedAt ? input.updatedAt : now,
  };
}

function normalizeQuota(input: Partial<QuotaConfig> | undefined): QuotaConfig {
  const next: QuotaConfig = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    groups: {},
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
  const groups = input?.groups ?? {};
  for (const [key, value] of Object.entries(groups)) next.groups![key] = normalizeGroup(value);
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
  const db = getAdminMysqlDb();
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
      .onDuplicateKeyUpdate({
        set: {
          config: seed as unknown as Record<string, unknown>,
          updatedAt: new Date(seed.updatedAt),
        },
      });
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
  const db = getAdminMysqlDb();
  await db
    .insert(qTable)
    .values({
      tenantId: tid,
      config: next as unknown as Record<string, unknown>,
      updatedAt: new Date(next.updatedAt),
    })
    .onDuplicateKeyUpdate({
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

export type PlanScopeType = "tenant" | "dept" | "user";

export type QuotaPlanSources = Record<string, string>;

function planSourceKey(scopeType: PlanScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

/** 读取套餐映射来源表（存于 config 元数据，网关忽略）。 */
export function getPlanSources(config: QuotaConfig): QuotaPlanSources {
  const raw = (config as QuotaConfig & { _planSources?: QuotaPlanSources })._planSources;
  return raw && typeof raw === "object" ? { ...raw } : {};
}

/** 将套餐额度写入 token-quota 配置对应 scope，并记录 plan 来源。 */
export function applyPlanRuleToScope(
  config: QuotaConfig,
  scopeType: PlanScopeType,
  scopeId: string,
  rule: QuotaRule,
  planId: string,
): QuotaConfig {
  const next = normalizeQuota(config);
  const normalized = normalizeRule(rule);
  const sources = getPlanSources(next);
  sources[planSourceKey(scopeType, scopeId)] = planId;
  (next as QuotaConfig & { _planSources?: QuotaPlanSources })._planSources = sources;

  if (scopeType === "user") {
    next.users[scopeId] = normalized;
  } else if (scopeType === "dept") {
    next.departments[scopeId] = { ...normalized, poolScope: "dept" };
  } else {
    next.defaults.role["_plan_tenant"] = { ...normalized, poolScope: "tenant" };
  }
  return next;
}

/** 移除套餐写入的 scope 规则（仅当来源 planId 匹配或未指定 planId）。 */
export function removePlanRuleFromScope(
  config: QuotaConfig,
  scopeType: PlanScopeType,
  scopeId: string,
  planId?: string,
): QuotaConfig {
  const next = normalizeQuota(config);
  const sources = getPlanSources(next);
  const key = planSourceKey(scopeType, scopeId);
  if (planId && sources[key] && sources[key] !== planId) {
    return next;
  }
  delete sources[key];
  (next as QuotaConfig & { _planSources?: QuotaPlanSources })._planSources = sources;

  if (scopeType === "user") {
    delete next.users[scopeId];
  } else if (scopeType === "dept") {
    delete next.departments[scopeId];
  } else {
    delete next.defaults.role["_plan_tenant"];
  }
  return next;
}

/** 整包写回 PG（供套餐发布映射调用）。 */
export async function persistQuotaConfig(config: QuotaConfig): Promise<QuotaConfig> {
  return setQuotaConfig(config);
}
