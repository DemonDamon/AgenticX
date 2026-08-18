import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeBudgets as budgetTable, gatewayBudgetAlerts as alertTable } from "@agenticx/db-schema/mysql";
import {
  DEFAULT_SESSION_TOKEN_LIMITS,
  normalizeSessionTokenLimits,
  type SessionTokenLimits,
} from "@agenticx/config";
import { desc, eq } from "drizzle-orm";

export type BudgetAction = "block" | "warn" | "fallback";

export type BudgetRule = {
  unit: "cost_usd" | "tokens";
  period: "day" | "month";
  limit: number;
  warnThresholdPct?: number;
  action: BudgetAction;
  fallbackModel?: string;
};

export type BudgetConfig = {
  updatedAt: string;
  companyLimits?: {
    tokens: number;
    costUsd: number;
  };
  sessionTokenLimits: SessionTokenLimits;
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

const DEFAULT_CONFIG: BudgetConfig = {
  updatedAt: new Date().toISOString(),
  companyLimits: { tokens: 0, costUsd: 0 },
  sessionTokenLimits: DEFAULT_SESSION_TOKEN_LIMITS,
  defaults: {
    unit: "cost_usd",
    period: "month",
    limit: 0,
    warnThresholdPct: 80,
    action: "warn",
  },
  tenants: {},
  departments: {},
  users: {},
};

function tenant(explicitTenantId?: string): string {
  const t = (explicitTenantId ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for budget config.");
  return t;
}

function normalizeRule(input: Partial<BudgetRule> | undefined): BudgetRule {
  const unit = input?.unit === "tokens" ? "tokens" : "cost_usd";
  const period = input?.period === "day" ? "day" : "month";
  const limit = Number(input?.limit ?? 0);
  const warnThresholdPct = Number(input?.warnThresholdPct ?? 80);
  const action = input?.action === "block" || input?.action === "fallback" ? input.action : "warn";
  return {
    unit,
    period,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    warnThresholdPct: Number.isFinite(warnThresholdPct) ? Math.min(100, Math.max(0, warnThresholdPct)) : 80,
    action,
    fallbackModel: input?.fallbackModel?.trim() || undefined,
  };
}

function normalizeBudget(input: Partial<BudgetConfig> | undefined): BudgetConfig {
  const tokenLimit = Number(input?.companyLimits?.tokens ?? 0);
  const costLimit = Number(input?.companyLimits?.costUsd ?? 0);
  const next: BudgetConfig = {
    updatedAt: new Date().toISOString(),
    companyLimits: {
      tokens: Number.isFinite(tokenLimit) && tokenLimit > 0 ? Math.floor(tokenLimit) : 0,
      costUsd: Number.isFinite(costLimit) && costLimit > 0 ? costLimit : 0,
    },
    sessionTokenLimits: normalizeSessionTokenLimits(input?.sessionTokenLimits),
    defaults: normalizeRule(input?.defaults ?? DEFAULT_CONFIG.defaults),
    tenants: {},
    departments: {},
    users: {},
  };
  for (const [k, v] of Object.entries(input?.tenants ?? {})) next.tenants![k] = normalizeRule(v);
  for (const [k, v] of Object.entries(input?.departments ?? {})) next.departments![k] = normalizeRule(v);
  for (const [k, v] of Object.entries(input?.users ?? {})) next.users![k] = normalizeRule(v);
  return next;
}

export async function getBudgetConfig(tenantId?: string): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const db = getAdminMysqlDb();
  const row = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
  if (!row.length) {
    const seed = normalizeBudget(DEFAULT_CONFIG);
    await db
      .insert(budgetTable)
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
  const cfg = row[0]?.config as Partial<BudgetConfig> | undefined;
  return normalizeBudget(cfg ?? DEFAULT_CONFIG);
}

export async function setBudgetConfig(
  input: Partial<BudgetConfig>,
  tenantId?: string,
): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const next = normalizeBudget(input);
  const db = getAdminMysqlDb();
  await db
    .insert(budgetTable)
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

export async function buildBudgetSnapshotForGateway(tenantId?: string): Promise<BudgetConfig> {
  return getBudgetConfig(tenantId);
}

export async function listBudgetAlerts(limit = 50, tenantId?: string) {
  const tid = tenant(tenantId);
  const db = getAdminMysqlDb();
  return db
    .select()
    .from(alertTable)
    .where(eq(alertTable.tenantId, tid))
    .orderBy(desc(alertTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
