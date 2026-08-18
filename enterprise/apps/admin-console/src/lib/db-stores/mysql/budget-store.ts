import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeBudgets as budgetTable, gatewayBudgetAlerts as alertTable } from "@agenticx/db-schema/mysql";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  BudgetConfigConflictError,
  defaultBudgetConfig,
  mergeBudgetConfigPatch,
  nextBudgetUpdatedAt,
  normalizeBudgetConfig,
  requestedBudgetVersion,
  sameBudgetVersion,
  type BudgetAction,
  type BudgetConfig,
  type BudgetConfigPatch,
  type BudgetRule,
} from "../budget-config";

export {
  BudgetConfigConflictError,
  type BudgetAction,
  type BudgetConfig,
  type BudgetRule,
};

const MAX_BUDGET_WRITE_ATTEMPTS = 4;

function tenant(explicitTenantId?: string): string {
  const t = (explicitTenantId ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for budget config.");
  return t;
}

export async function getBudgetConfig(tenantId?: string): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const db = getAdminMysqlDb();
  let rows = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
  if (!rows.length) {
    const updatedAt = new Date();
    const seed = defaultBudgetConfig(updatedAt);
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
    rows = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
  }
  const row = rows[0];
  if (!row) throw new Error("budget config could not be initialized");
  return normalizeBudgetConfig(row.config as Partial<BudgetConfig> | undefined, row.updatedAt);
}

export async function setBudgetConfig(
  input: BudgetConfigPatch,
  tenantId?: string,
  expectedUpdatedAt?: string,
): Promise<BudgetConfig> {
  const tid = tenant(tenantId);
  const db = getAdminMysqlDb();
  const requestedVersion = requestedBudgetVersion(input, expectedUpdatedAt);

  for (let attempt = 0; attempt < MAX_BUDGET_WRITE_ATTEMPTS; attempt += 1) {
    const rows = await db.select().from(budgetTable).where(eq(budgetTable.tenantId, tid)).limit(1);
    const row = rows[0];

    if (!row) {
      if (requestedVersion) throw new BudgetConfigConflictError();
      const updatedAt = new Date();
      const next = mergeBudgetConfigPatch(defaultBudgetConfig(updatedAt), input, updatedAt);
      await db
        .insert(budgetTable)
        .values({
          tenantId: tid,
          config: next as unknown as Record<string, unknown>,
          updatedAt,
        })
        .onDuplicateKeyUpdate({
          set: { tenantId: sql`${budgetTable.tenantId}` },
        });
      const afterInsert = await db
        .select()
        .from(budgetTable)
        .where(eq(budgetTable.tenantId, tid))
        .limit(1);
      if (JSON.stringify(afterInsert[0]?.config) === JSON.stringify(next)) return next;
      continue;
    }

    const currentUpdatedAt = row.updatedAt;
    if (requestedVersion && !sameBudgetVersion(requestedVersion, currentUpdatedAt)) {
      throw new BudgetConfigConflictError();
    }
    const updatedAt = nextBudgetUpdatedAt(currentUpdatedAt);
    const current = normalizeBudgetConfig(
      row.config as Partial<BudgetConfig> | undefined,
      currentUpdatedAt,
    );
    const next = mergeBudgetConfigPatch(current, input, updatedAt);
    const updated = await db
      .update(budgetTable)
      .set({
        config: next as unknown as Record<string, unknown>,
        updatedAt,
      })
      .where(
        and(
          eq(budgetTable.tenantId, tid),
          eq(budgetTable.updatedAt, currentUpdatedAt),
        ),
      );
    if (updated[0].affectedRows > 0) return next;
    if (requestedVersion) throw new BudgetConfigConflictError();
  }

  throw new BudgetConfigConflictError();
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
