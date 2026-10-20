import { enterpriseRuntimeBudgets as budgetTable, gatewayBudgetAlerts as alertTable } from "@agenticx/db-schema";
import { getIamDb, listUserGroups } from "@agenticx/iam-core";
import { and, desc, eq } from "drizzle-orm";

export type BudgetAction = "block" | "warn" | "fallback";

export type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "week" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: BudgetAction;
  fallbackModel?: string;
};

export type CompanyMonthlyLimits = {
  tokens: number;
  costUsd: number;
};

export type BudgetConfig = {
  version: 2;
  updatedAt: string;
  companyLimits: CompanyMonthlyLimits;
  defaults: BudgetRule;
  tenants: Record<string, BudgetRule>;
  departments: Record<string, BudgetRule>;
  groups: Record<string, BudgetRule>;
  users: Record<string, BudgetRule>;
};

export type BudgetConfigPatch = Partial<
  Pick<BudgetConfig, "companyLimits" | "defaults" | "tenants" | "departments" | "groups" | "users">
>;

export type BudgetGatewaySnapshot = BudgetConfig & {
  userGroups: Record<string, string[]>;
};

export type SetBudgetOptions = {
  expectedUpdatedAt?: string;
};

export const BUDGET_PATCH_KEYS = [
  "companyLimits",
  "defaults",
  "tenants",
  "departments",
  "groups",
  "users",
] as const;

export class BudgetConflictError extends Error {
  constructor() {
    super("budget config was updated by another request");
    this.name = "BudgetConflictError";
  }
}

const DEFAULT_RULE: BudgetRule = {
  unit: "cost_usd",
  period: "month",
  limit: 0,
  warnThresholdPct: 80,
  action: "warn",
};

function unsetRule(): BudgetRule {
  return { ...DEFAULT_RULE };
}

function tenant(explicit?: string): string {
  const value = (explicit ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!value) throw new Error("DEFAULT_TENANT_ID is required for budget config.");
  return value;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function toIso(value: Date | string | undefined): string {
  const parsed = value instanceof Date ? value : asDate(value);
  return (parsed ?? new Date()).toISOString();
}

function sameBudgetVersion(expected: string, stored: unknown): boolean {
  const left = new Date(expected).getTime();
  const right = asDate(stored)?.getTime();
  return Number.isFinite(left) && right !== undefined && left === right;
}

function nextBudgetUpdatedAt(current: Date | undefined, now = new Date()): Date {
  if (!current || now.getTime() > current.getTime()) return now;
  return new Date(current.getTime() + 1);
}

function normalizeRule(input: unknown): BudgetRule {
  const record = input && typeof input === "object" ? (input as Partial<BudgetRule>) : undefined;
  const unit = record?.unit === "tokens" ? "tokens" : "cost_usd";
  const period = record?.period === "day" || record?.period === "week" || record?.period === "month" ? record.period : "month";
  const limit = Number(record?.limit ?? 0);
  const warnThresholdPct = Number(record?.warnThresholdPct ?? 80);
  const action = record?.action === "block" || record?.action === "fallback" ? record.action : "warn";
  const fallbackModel = record?.fallbackModel?.trim() || undefined;
  return {
    unit,
    period,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    warnThresholdPct: Number.isFinite(warnThresholdPct) ? Math.min(100, Math.max(0, warnThresholdPct)) : 80,
    action,
    ...(fallbackModel ? { fallbackModel } : {}),
  };
}

function forceBlock(rule: BudgetRule): BudgetRule {
  const next: BudgetRule = { ...rule, action: "block" };
  delete next.fallbackModel;
  return next;
}

function normalizeRuleMap(input: unknown, sharedPool: boolean): Record<string, BudgetRule> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, BudgetRule> = {};
  for (const [key, value] of Object.entries(input)) {
    const id = key.trim();
    if (!id) continue;
    const rule = normalizeRule(value);
    out[id] = sharedPool ? forceBlock(rule) : rule;
  }
  return out;
}

function normalizeCompanyLimits(input: unknown): CompanyMonthlyLimits {
  const record = input && typeof input === "object" ? (input as Partial<CompanyMonthlyLimits>) : undefined;
  const tokens = Number(record?.tokens ?? 0);
  const costUsd = Number(record?.costUsd ?? 0);
  return {
    tokens: Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0,
    costUsd: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
  };
}

function isV2(input: unknown): boolean {
  return Number((input as { version?: unknown } | null)?.version) === 2;
}

/**
 * 无 version 的旧配置里，defaults 记在租户维度，相当于组织共享上限，不是每人兜底。
 * 已有 tenants[当前租户] 且 limit > 0 时保留它（旧选择顺序是租户规则优先于 defaults）。
 */
export function normalizeBudget(
  input: (BudgetConfigPatch & { version?: number }) | null | undefined,
  options?: { updatedAt?: Date | string; tenantId?: string },
): BudgetConfig {
  const tenantId = options?.tenantId?.trim() || process.env.DEFAULT_TENANT_ID?.trim() || "";
  const legacy = !isV2(input);
  const legacyDefaults = normalizeRule(input?.defaults);
  let tenants = normalizeRuleMap(input?.tenants, true);
  let defaults = legacy ? unsetRule() : normalizeRule(input?.defaults ?? DEFAULT_RULE);
  if (legacy && legacyDefaults.limit > 0) {
    if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required for budget config.");
    const existing = tenants[tenantId];
    if (!existing || existing.limit <= 0) tenants = { ...tenants, [tenantId]: forceBlock(legacyDefaults) };
    defaults = unsetRule();
  }
  return {
    version: 2,
    updatedAt: toIso(options?.updatedAt),
    companyLimits: normalizeCompanyLimits(input?.companyLimits),
    defaults,
    tenants,
    departments: normalizeRuleMap(input?.departments, true),
    groups: normalizeRuleMap(input?.groups, false),
    users: normalizeRuleMap(input?.users, false),
  };
}

export function mergeBudgetPatch(current: BudgetConfig, patch: BudgetConfigPatch): BudgetConfig {
  const next: BudgetConfig = { ...current };
  for (const key of BUDGET_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    switch (key) {
      case "companyLimits":
        next.companyLimits = patch.companyLimits ?? { tokens: 0, costUsd: 0 };
        break;
      case "defaults":
        next.defaults = patch.defaults ?? unsetRule();
        break;
      case "tenants":
        next.tenants = patch.tenants ?? {};
        break;
      case "departments":
        next.departments = patch.departments ?? {};
        break;
      case "groups":
        next.groups = patch.groups ?? {};
        break;
      case "users":
        next.users = patch.users ?? {};
        break;
      default: {
        const _exhaustive: never = key;
        throw new Error(`unsupported budget field: ${String(_exhaustive)}`);
      }
    }
  }
  return next;
}

export function budgetGatewaySnapshot(
  config: BudgetConfig,
  groups: readonly { id: string; memberIds: readonly string[] }[],
): BudgetGatewaySnapshot {
  const userGroups: Record<string, string[]> = {};
  const activeGroupIds = new Set(groups.map((group) => group.id));
  const activeRules = Object.fromEntries(Object.entries(config.groups ?? {}).filter(([id]) => activeGroupIds.has(id)));
  for (const group of groups) {
    const rule = config.groups?.[group.id];
    if (!rule || rule.limit <= 0) continue;
    for (const userId of group.memberIds) {
      const member = userId.trim();
      if (!member) continue;
      const current = userGroups[member] ?? [];
      if (!current.includes(group.id)) current.push(group.id);
      userGroups[member] = current;
    }
  }
  for (const memberships of Object.values(userGroups)) memberships.sort();
  return { ...config, groups: activeRules, userGroups };
}

export async function getBudgetConfig(tenantId?: string): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const db = getIamDb();
  const rows = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
  const row = rows[0];
  if (!row) {
    const updatedAt = new Date();
    const seed = normalizeBudget(undefined, { updatedAt, tenantId: tid });
    await db
      .insert(budgetTable)
      .values({
        tenantId: tid,
        config: seed as unknown as Record<string, unknown>,
        updatedAt,
      })
      .onConflictDoNothing();
    return seed;
  }
  const storedAt = asDate(row.updatedAt) ?? asDate((row.config as { updatedAt?: string } | null)?.updatedAt);
  return normalizeBudget(row.config as BudgetConfigPatch & { version?: number }, {
    updatedAt: storedAt,
    tenantId: tid,
  });
}

export async function setBudgetConfig(input: BudgetConfigPatch, options?: SetBudgetOptions): Promise<BudgetConfig> {
  const tid = tenant();
  const db = getIamDb();
  const rows = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
  const row = rows[0];
  const expected = options?.expectedUpdatedAt;
  if (expected !== undefined && (!row || !sameBudgetVersion(expected, row.updatedAt))) {
    throw new BudgetConflictError();
  }

  const storedAt = row ? asDate(row.updatedAt) : undefined;
  const current = normalizeBudget((row?.config as BudgetConfigPatch & { version?: number } | undefined) ?? undefined, {
    updatedAt: storedAt ?? new Date(),
    tenantId: tid,
  });
  const updatedAt = nextBudgetUpdatedAt(storedAt);
  const next = normalizeBudget({ ...mergeBudgetPatch(current, input), version: 2 }, { updatedAt, tenantId: tid });
  const config = next as unknown as Record<string, unknown>;

  if (expected !== undefined) {
    const updated = await db
      .update(budgetTable)
      .set({ config, updatedAt })
      .where(and(eq(budgetTable.tenantId, tid), eq(budgetTable.updatedAt, row!.updatedAt)))
      .returning({ tenantId: budgetTable.tenantId });
    if (!updated.length) throw new BudgetConflictError();
    return next;
  }

  await db
    .insert(budgetTable)
    .values({ tenantId: tid, config, updatedAt })
    .onConflictDoUpdate({
      target: budgetTable.tenantId,
      set: { config, updatedAt },
    });
  return next;
}

export async function buildBudgetSnapshotForGateway(tenantId?: string): Promise<BudgetGatewaySnapshot> {
  const tid = tenant(tenantId);
  const [config, groups] = await Promise.all([getBudgetConfig(tid), listUserGroups(tid)]);
  return budgetGatewaySnapshot(
    config,
    groups.map((group) => ({ id: group.id, memberIds: group.memberIds })),
  );
}

export async function listBudgetAlerts(limit = 50) {
  const tid = tenant();
  const db = getIamDb();
  return db
    .select()
    .from(alertTable)
    .where(eq(alertTable.tenantId, tid))
    .orderBy(desc(alertTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
