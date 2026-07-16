import { enterpriseRuntimeBudgets as budgetTable, gatewayBudgetAlerts as alertTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
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
  defaults?: BudgetRule;
  tenants?: Record<string, BudgetRule>;
  departments?: Record<string, BudgetRule>;
  users?: Record<string, BudgetRule>;
};

const DEFAULT_CONFIG: BudgetConfig = {
  updatedAt: new Date().toISOString(),
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

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
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
  const next: BudgetConfig = {
    updatedAt: new Date().toISOString(),
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

export async function getBudgetConfig(): Promise<BudgetConfig> {
  const tid = tenant();
  const db = getIamDb();
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
      .onConflictDoNothing();
    return seed;
  }
  const cfg = row[0]?.config as Partial<BudgetConfig> | undefined;
  return normalizeBudget(cfg ?? DEFAULT_CONFIG);
}

export async function setBudgetConfig(input: Partial<BudgetConfig>): Promise<BudgetConfig> {
  const tid = tenant();
  const next = normalizeBudget(input);
  const db = getIamDb();
  await db
    .insert(budgetTable)
    .values({
      tenantId: tid,
      config: next as unknown as Record<string, unknown>,
      updatedAt: new Date(next.updatedAt),
    })
    .onConflictDoUpdate({
      target: budgetTable.tenantId,
      set: {
        config: next as unknown as Record<string, unknown>,
        updatedAt: new Date(next.updatedAt),
      },
    });
  return next;
}

export async function buildBudgetSnapshotForGateway(): Promise<BudgetConfig> {
  return getBudgetConfig();
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
