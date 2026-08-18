import { enterpriseRuntimeTokenQuotas as qTable } from "@agenticx/db-schema";
import { getIamDb, migrateLegacyQuotasIfNeeded, resolveRuntimeAdminDir, type QuotaConfig as SharedQuotaConfig } from "@agenticx/iam-core";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  mergeQuotaConfigPatch,
  nextQuotaUpdatedAt,
  QuotaConfigConflictError,
  requestedQuotaVersion,
  sameQuotaVersion,
} from "../token-quota-config";

export { QuotaConfigConflictError } from "../token-quota-config";

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
  /** 用户组派生的可用模型范围；成员可在此基础上增加或关闭个人模型。 */
  modelIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type QuotaConfig = SharedQuotaConfig & {
  apiTokens?: Record<string, QuotaRule>;
  groups?: Record<string, UserGroup>;
  /** 用户可撤销用户组派生模型的个人例外。 */
  modelExclusions?: Record<string, string[]>;
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
  modelExclusions: {},
  updatedAt: new Date().toISOString(),
};

const legacyMigrations = new Map<string, Promise<void>>();
const MAX_QUOTA_WRITE_ATTEMPTS = 4;

function tenant(explicitTenantId: string): string {
  const t = explicitTenantId?.trim();
  if (!t) throw new Error("tenantId is required for quota config.");
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

function normalizeModelExclusions(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const exclusions: Record<string, string[]> = {};
  for (const [userId, value] of Object.entries(input)) {
    const id = userId.trim();
    if (!id || !Array.isArray(value)) continue;
    const modelIds = [...new Set(value.map((modelId) => String(modelId).trim()).filter(Boolean))];
    if (modelIds.length > 0) exclusions[id] = modelIds;
  }
  return exclusions;
}

function normalizeQuota(
  input: Partial<QuotaConfig> | undefined,
  updatedAt?: Date,
): QuotaConfig {
  const inputUpdatedAt = typeof input?.updatedAt === "string" ? new Date(input.updatedAt) : null;
  const resolvedUpdatedAt =
    updatedAt ?? (inputUpdatedAt && !Number.isNaN(inputUpdatedAt.getTime()) ? inputUpdatedAt : new Date());
  const next: QuotaConfig = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    groups: {},
    modelExclusions: {},
    apiTokens: {},
    updatedAt: resolvedUpdatedAt.toISOString(),
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
  next.modelExclusions = normalizeModelExclusions(input?.modelExclusions);
  const apiTokens = input?.apiTokens ?? {};
  for (const [key, value] of Object.entries(apiTokens)) next.apiTokens![key] = normalizeRule(value);
  return next;
}

function configFromRow(
  payload: Record<string, unknown> | undefined | null,
  updatedAt: Date,
): QuotaConfig | null {
  if (!payload || typeof payload !== "object") return null;
  return normalizeQuota(payload as Partial<QuotaConfig>, updatedAt);
}

async function migrateLegacyQuotasOnce(tid: string): Promise<void> {
  let migration = legacyMigrations.get(tid);
  if (!migration) {
    migration = migrateLegacyQuotasIfNeeded(tid)
      .then(() => undefined)
      .catch((error) => {
        legacyMigrations.delete(tid);
        throw error;
      });
    legacyMigrations.set(tid, migration);
  }
  await migration;
}

/** 租户 token 配额整包读取。 */
export async function getQuotaConfig(tenantId: string): Promise<QuotaConfig> {
  const tid = tenant(tenantId);
  await migrateLegacyQuotasOnce(tid);
  const db = getIamDb();
  let rows = await db.select().from(qTable).where(eq(qTable.tenantId, tid)).limit(1);
  if (!rows.length) {
    /** 尚无记录时写入默认模板并返回（等同旧 json 首次自动生成）。 */
    const updatedAt = new Date();
    const seed = normalizeQuota(DEFAULT_CONFIG, updatedAt);
    const inserted = await db
      .insert(qTable)
      .values({
        tenantId: tid,
        config: seed as unknown as Record<string, unknown>,
        updatedAt,
      })
      .onConflictDoNothing()
      .returning({ tenantId: qTable.tenantId });
    if (inserted.length) return seed;
    rows = await db.select().from(qTable).where(eq(qTable.tenantId, tid)).limit(1);
  }
  const row = rows[0];
  if (!row) throw new Error("quota config could not be initialized");
  const parsed = configFromRow(row.config as Record<string, unknown>, row.updatedAt);
  return parsed ?? normalizeQuota(DEFAULT_CONFIG, row.updatedAt);
}

export async function setQuotaConfig(
  input: Partial<QuotaConfig>,
  tenantId: string,
  expectedUpdatedAt?: string,
): Promise<QuotaConfig> {
  const tid = tenant(tenantId);
  await migrateLegacyQuotasOnce(tid);
  const db = getIamDb();
  const requestedVersion = requestedQuotaVersion(input, expectedUpdatedAt);

  for (let attempt = 0; attempt < MAX_QUOTA_WRITE_ATTEMPTS; attempt += 1) {
    const rows = await db.select().from(qTable).where(eq(qTable.tenantId, tid)).limit(1);
    const row = rows[0];

    if (!row) {
      if (requestedVersion) throw new QuotaConfigConflictError();
      const updatedAt = new Date();
      const next = normalizeQuota(input, updatedAt);
      const inserted = await db
        .insert(qTable)
        .values({
          tenantId: tid,
          config: next as unknown as Record<string, unknown>,
          updatedAt,
        })
        .onConflictDoNothing()
        .returning({ tenantId: qTable.tenantId });
      if (inserted.length) return next;
      continue;
    }

    if (requestedVersion && !sameQuotaVersion(requestedVersion, row.updatedAt)) {
      throw new QuotaConfigConflictError();
    }
    const updatedAt = nextQuotaUpdatedAt(row.updatedAt);
    const current = configFromRow(row.config as Record<string, unknown>, row.updatedAt)
      ?? normalizeQuota(DEFAULT_CONFIG, row.updatedAt);
    const next = normalizeQuota(mergeQuotaConfigPatch(current, input), updatedAt);
    const updated = await db
      .update(qTable)
      .set({
        config: next as unknown as Record<string, unknown>,
        updatedAt,
      })
      .where(and(eq(qTable.tenantId, tid), eq(qTable.updatedAt, row.updatedAt)))
      .returning({ tenantId: qTable.tenantId });
    if (updated.length) return next;
    if (requestedVersion) throw new QuotaConfigConflictError();
  }

  throw new QuotaConfigConflictError();
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
export async function persistQuotaConfig(
  config: QuotaConfig,
  tenantId: string,
): Promise<QuotaConfig> {
  return setQuotaConfig(config, tenantId);
}
