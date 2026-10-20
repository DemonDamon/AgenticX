import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeBudgets as budgetTable, gatewayBudgetAlerts as alertTable } from "@agenticx/db-schema/mysql";
import { listUserGroups } from "@agenticx/iam-core";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  BUDGET_PATCH_KEYS,
  BudgetConflictError,
  budgetGatewaySnapshot,
  mergeBudgetPatch,
  normalizeBudget,
  type BudgetConfig,
  type BudgetConfigPatch,
  type BudgetGatewaySnapshot,
  type SetBudgetOptions,
} from "../postgresql/budget-store";

export {
  BUDGET_PATCH_KEYS,
  BudgetConflictError,
  budgetGatewaySnapshot,
  mergeBudgetPatch,
  normalizeBudget,
};
export type {
  BudgetAction,
  BudgetConfig,
  BudgetConfigPatch,
  BudgetGatewaySnapshot,
  BudgetRule,
  CompanyMonthlyLimits,
  SetBudgetOptions,
} from "../postgresql/budget-store";

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

function sameBudgetVersion(expected: string, stored: unknown): boolean {
  const left = new Date(expected).getTime();
  const right = asDate(stored)?.getTime();
  return Number.isFinite(left) && right !== undefined && left === right;
}

function nextBudgetUpdatedAt(current: Date | undefined, now = new Date()): Date {
  if (!current || now.getTime() > current.getTime()) return now;
  return new Date(current.getTime() + 1);
}

export async function getBudgetConfig(tenantId?: string): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const db = getAdminMysqlDb();
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
      .onDuplicateKeyUpdate({
        set: { tenantId: sql`${budgetTable.tenantId}` },
      });
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
  const db = getAdminMysqlDb();
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
      .where(and(eq(budgetTable.tenantId, tid), eq(budgetTable.updatedAt, row!.updatedAt)));
    if ((updated[0]?.affectedRows ?? 0) < 1) throw new BudgetConflictError();
    return next;
  }

  await db.insert(budgetTable).values({ tenantId: tid, config, updatedAt }).onDuplicateKeyUpdate({
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
  const db = getAdminMysqlDb();
  return db
    .select()
    .from(alertTable)
    .where(eq(alertTable.tenantId, tid))
    .orderBy(desc(alertTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
