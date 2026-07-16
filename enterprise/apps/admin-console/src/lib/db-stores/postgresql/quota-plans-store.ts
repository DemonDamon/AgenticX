import {
  enterpriseQuotaPlanAssignments as assignTable,
  enterpriseQuotaPlans as planTable,
  gatewayQuotaLedger,
  gatewayQuotaPoolUsage,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import {
  applyPlanRuleToScope,
  getPlanSources,
  getQuotaConfig,
  persistQuotaConfig,
  removePlanRuleFromScope,
  type PlanScopeType,
  type QuotaRule,
} from "../../token-quota-store";

export type { PlanScopeType };

export type PlanPeriod = "month" | "week";
export type PlanStatus = "draft" | "active" | "archived";
export type AssignmentStatus = "active" | "ended" | "cancelled";

export type QuotaPlanRecord = {
  id: string;
  tenantId: string;
  name: string;
  monthlyTokens: number;
  rpm: number;
  tpm: number;
  maxConcurrency: number;
  models: string[];
  period: PlanPeriod;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type QuotaPlanAssignmentRecord = {
  id: string;
  tenantId: string;
  planId: string;
  scopeType: PlanScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: AssignmentStatus;
  pendingPlanId: string | null;
  lastRolloverKey: string | null;
  createdAt: string;
  updatedAt: string;
};

function tenantId(explicit?: string): string {
  const t = (explicit ?? process.env.DEFAULT_TENANT_ID)?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for quota plans.");
  return t;
}

function normalizePlanPeriod(value: unknown): PlanPeriod {
  return String(value ?? "").trim() === "week" ? "week" : "month";
}

function normalizePlanStatus(value: unknown): PlanStatus {
  const v = String(value ?? "").trim();
  if (v === "active" || v === "archived") return v;
  return "draft";
}

function normalizeScopeType(value: unknown): PlanScopeType {
  const v = String(value ?? "").trim();
  if (v === "tenant" || v === "dept" || v === "user") return v;
  throw new Error("invalid scope_type; expected tenant|dept|user");
}

function rowToPlan(row: typeof planTable.$inferSelect): QuotaPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    monthlyTokens: Number(row.monthlyTokens) || 0,
    rpm: row.rpm ?? 0,
    tpm: row.tpm ?? 0,
    maxConcurrency: row.maxConcurrency ?? 0,
    models: Array.isArray(row.models) ? row.models : [],
    period: normalizePlanPeriod(row.period),
    status: normalizePlanStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToAssignment(row: typeof assignTable.$inferSelect): QuotaPlanAssignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planId: row.planId,
    scopeType: row.scopeType as PlanScopeType,
    scopeId: row.scopeId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    status: (row.status as AssignmentStatus) ?? "active",
    pendingPlanId: row.pendingPlanId ?? null,
    lastRolloverKey: row.lastRolloverKey ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function computePeriodBounds(period: PlanPeriod, ref: Date): { start: Date; end: Date } {
  const d = new Date(ref.getTime());
  if (period === "week") {
    const day = d.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
    const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000 - 1);
    return { start, end };
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

export function computeNextPeriodBounds(period: PlanPeriod, currentEnd: Date): { start: Date; end: Date } {
  const nextRef = new Date(currentEnd.getTime() + 1000);
  return computePeriodBounds(period, nextRef);
}

export function poolPeriodKey(ref: Date): string {
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function planToQuotaRule(plan: Pick<QuotaPlanRecord, "monthlyTokens" | "rpm" | "tpm" | "maxConcurrency">): QuotaRule {
  return {
    monthlyTokens: plan.monthlyTokens,
    rpm: plan.rpm,
    tpm: plan.tpm,
    maxConcurrency: plan.maxConcurrency,
    poolScope: "",
    action: "block",
  };
}

export async function listQuotaPlans(tid?: string): Promise<QuotaPlanRecord[]> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  const rows = await db.select().from(planTable).where(eq(planTable.tenantId, tenant));
  return rows.map(rowToPlan).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getQuotaPlan(id: string, tid?: string): Promise<QuotaPlanRecord | null> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(planTable)
    .where(and(eq(planTable.tenantId, tenant), eq(planTable.id, id)))
    .limit(1);
  return rows[0] ? rowToPlan(rows[0]) : null;
}

export async function createQuotaPlan(input: Partial<QuotaPlanRecord>, tid?: string): Promise<QuotaPlanRecord> {
  const tenant = tenantId(tid);
  const monthlyTokens = Number(input.monthlyTokens ?? 0);
  if (!Number.isFinite(monthlyTokens) || monthlyTokens <= 0) {
    throw new Error("monthly_tokens must be a positive number");
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name is required");

  const createdAt = new Date();
  const row = {
    id: ulid(),
    tenantId: tenant,
    name,
    monthlyTokens: Math.floor(monthlyTokens),
    rpm: Math.max(0, Math.floor(Number(input.rpm ?? 0))),
    tpm: Math.max(0, Math.floor(Number(input.tpm ?? 0))),
    maxConcurrency: Math.max(0, Math.floor(Number(input.maxConcurrency ?? 0))),
    models: Array.isArray(input.models) ? input.models.map(String) : [],
    period: normalizePlanPeriod(input.period),
    status: "draft" as PlanStatus,
    createdAt,
    updatedAt: createdAt,
  };
  const db = getIamDb();
  await db.insert(planTable).values(row);
  return rowToPlan(row);
}

export async function updateQuotaPlan(id: string, input: Partial<QuotaPlanRecord>, tid?: string): Promise<QuotaPlanRecord> {
  const tenant = tenantId(tid);
  const existing = await getQuotaPlan(id, tenant);
  if (!existing) throw new Error("plan not found");
  if (existing.status === "archived") throw new Error("archived plan cannot be edited");

  const patch = {
    name: input.name !== undefined ? String(input.name).trim() || existing.name : existing.name,
    monthlyTokens:
      input.monthlyTokens !== undefined
        ? Math.max(0, Math.floor(Number(input.monthlyTokens)))
        : existing.monthlyTokens,
    rpm: input.rpm !== undefined ? Math.max(0, Math.floor(Number(input.rpm))) : existing.rpm,
    tpm: input.tpm !== undefined ? Math.max(0, Math.floor(Number(input.tpm))) : existing.tpm,
    maxConcurrency:
      input.maxConcurrency !== undefined
        ? Math.max(0, Math.floor(Number(input.maxConcurrency)))
        : existing.maxConcurrency,
    models: input.models !== undefined ? input.models : existing.models,
    period: input.period !== undefined ? normalizePlanPeriod(input.period) : existing.period,
    status: input.status !== undefined ? normalizePlanStatus(input.status) : existing.status,
    updatedAt: new Date(),
  };
  const db = getIamDb();
  await db.update(planTable).set(patch).where(and(eq(planTable.tenantId, tenant), eq(planTable.id, id)));
  return (await getQuotaPlan(id, tenant))!;
}

export async function deleteQuotaPlan(id: string, tid?: string): Promise<void> {
  const tenant = tenantId(tid);
  const plan = await getQuotaPlan(id, tenant);
  if (!plan) return;
  if (plan.status !== "draft") throw new Error("only draft plans can be deleted; archive active plans instead");
  const db = getIamDb();
  await db.delete(planTable).where(and(eq(planTable.tenantId, tenant), eq(planTable.id, id)));
}

export async function listPlanAssignments(planId: string, tid?: string): Promise<QuotaPlanAssignmentRecord[]> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(assignTable)
    .where(and(eq(assignTable.tenantId, tenant), eq(assignTable.planId, planId)));
  return rows.map(rowToAssignment);
}

export async function assignPlanToScope(input: {
  planId: string;
  scopeType: PlanScopeType;
  scopeId: string;
  effectiveNextPeriod?: boolean;
  tid?: string;
}): Promise<QuotaPlanAssignmentRecord> {
  const tenant = tenantId(input.tid);
  const plan = await getQuotaPlan(input.planId, tenant);
  if (!plan) throw new Error("plan not found");
  if (plan.status === "archived") throw new Error("cannot assign archived plan");

  const scopeType = normalizeScopeType(input.scopeType);
  const scopeId = String(input.scopeId ?? "").trim();
  if (!scopeId && scopeType !== "tenant") throw new Error("scope_id is required");
  const resolvedScopeId = scopeType === "tenant" ? tenant : scopeId;

  const db = getIamDb();
  const existingActive = await db
    .select()
    .from(assignTable)
    .where(
      and(
        eq(assignTable.tenantId, tenant),
        eq(assignTable.scopeType, scopeType),
        eq(assignTable.scopeId, resolvedScopeId),
        eq(assignTable.status, "active"),
      ),
    )
    .limit(1);

  const bounds = computePeriodBounds(plan.period, new Date());

  if (existingActive[0]) {
    const current = existingActive[0];
    if (input.effectiveNextPeriod && current.planId !== plan.id) {
      await db
        .update(assignTable)
        .set({ pendingPlanId: plan.id, updatedAt: new Date() })
        .where(eq(assignTable.id, current.id));
      return rowToAssignment({ ...current, pendingPlanId: plan.id, updatedAt: new Date() });
    }
    await db
      .update(assignTable)
      .set({ status: "ended", updatedAt: new Date() })
      .where(eq(assignTable.id, current.id));
  }

  const createdAt = new Date();
  const row = {
    id: ulid(),
    tenantId: tenant,
    planId: plan.id,
    scopeType,
    scopeId: resolvedScopeId,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    status: "active" as AssignmentStatus,
    pendingPlanId: null as string | null,
    lastRolloverKey: null as string | null,
    createdAt,
    updatedAt: createdAt,
  };
  await db.insert(assignTable).values(row);
  return rowToAssignment(row);
}

export async function cancelPlanAssignment(assignmentId: string, tid?: string): Promise<void> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(assignTable)
    .where(and(eq(assignTable.tenantId, tenant), eq(assignTable.id, assignmentId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await db
    .update(assignTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(assignTable.id, assignmentId));
  if (row.status === "active") {
    const config = await getQuotaConfig();
    const cleaned = removePlanRuleFromScope(config, row.scopeType as PlanScopeType, row.scopeId, row.planId);
    await persistQuotaConfig(cleaned);
  }
}

async function loadActivePlanAssignments(tid: string) {
  const db = getIamDb();
  return db
    .select({ assignment: assignTable, plan: planTable })
    .from(assignTable)
    .innerJoin(planTable, eq(assignTable.planId, planTable.id))
    .where(
      and(eq(assignTable.tenantId, tid), eq(assignTable.status, "active"), eq(planTable.status, "active")),
    );
}

export async function rebuildQuotaMappingFromPlans(tid?: string): Promise<{ mapped: number }> {
  const tenant = tenantId(tid);
  let config = await getQuotaConfig();
  const sources = getPlanSources(config);
  for (const [key, planId] of Object.entries(sources)) {
    const [scopeType, scopeId] = key.split(":");
    if (scopeType && scopeId) {
      config = removePlanRuleFromScope(config, scopeType as PlanScopeType, scopeId, planId);
    }
  }

  const rows = await loadActivePlanAssignments(tenant);
  for (const { assignment, plan } of rows) {
    config = applyPlanRuleToScope(
      config,
      assignment.scopeType as PlanScopeType,
      assignment.scopeId,
      planToQuotaRule(rowToPlan(plan)),
      plan.id,
    );
  }
  await persistQuotaConfig(config);
  return { mapped: rows.length };
}

export async function publishQuotaPlan(planId: string, tid?: string): Promise<{ plan: QuotaPlanRecord; mapped: number }> {
  const tenant = tenantId(tid);
  const plan = await getQuotaPlan(planId, tenant);
  if (!plan) throw new Error("plan not found");
  if (plan.status === "archived") throw new Error("archived plan cannot be published");

  const db = getIamDb();
  if (plan.status === "draft") {
    await db
      .update(planTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(planTable.tenantId, tenant), eq(planTable.id, planId)));
  }

  const result = await rebuildQuotaMappingFromPlans(tenant);
  return { plan: (await getQuotaPlan(planId, tenant))!, mapped: result.mapped };
}

export async function archiveQuotaPlan(planId: string, tid?: string): Promise<QuotaPlanRecord> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  await db
    .update(planTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(planTable.tenantId, tenant), eq(planTable.id, planId)));

  const assignments = await db
    .select()
    .from(assignTable)
    .where(and(eq(assignTable.tenantId, tenant), eq(assignTable.planId, planId), eq(assignTable.status, "active")));
  for (const row of assignments) {
    await db
      .update(assignTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(assignTable.id, row.id));
  }
  await rebuildQuotaMappingFromPlans(tenant);
  return (await getQuotaPlan(planId, tenant))!;
}

function poolScopeForAssignment(scopeType: PlanScopeType, tenant: string, scopeId: string) {
  if (scopeType === "dept") return { scopeType: "dept" as const, scopeId };
  if (scopeType === "user") return { scopeType: "dept" as const, scopeId };
  return { scopeType: "tenant" as const, scopeId: tenant };
}

async function resetPoolUsageForAssignment(
  tenant: string,
  scopeType: PlanScopeType,
  scopeId: string,
  period: string,
): Promise<void> {
  if (scopeType === "user") return;
  const db = getIamDb();
  const pool = poolScopeForAssignment(scopeType, tenant, scopeId);
  await db
    .update(gatewayQuotaPoolUsage)
    .set({ usedTotal: 0, updatedAt: new Date() })
    .where(
      and(
        eq(gatewayQuotaPoolUsage.tenantId, tenant),
        eq(gatewayQuotaPoolUsage.scopeType, pool.scopeType),
        eq(gatewayQuotaPoolUsage.scopeId, pool.scopeId),
        eq(gatewayQuotaPoolUsage.period, period),
      ),
    );
}

async function archivePoolLedger(
  tenant: string,
  scopeType: PlanScopeType,
  scopeId: string,
  period: string,
  requestId: string,
): Promise<void> {
  if (scopeType === "user") return;
  const db = getIamDb();
  const pool = poolScopeForAssignment(scopeType, tenant, scopeId);
  await db.insert(gatewayQuotaLedger).values({
    id: `qled-${ulid()}`,
    tenantId: tenant,
    scopeType: pool.scopeType,
    scopeId: pool.scopeId,
    period,
    event: "rollover_archive",
    deltaTokens: 0,
    requestId,
  });
}

export type RolloverResult = {
  assignmentId: string;
  scopeType: PlanScopeType;
  scopeId: string;
  archivedPeriod: string;
  skipped?: boolean;
};

export async function rolloverDueAssignments(tid?: string, now = new Date()): Promise<RolloverResult[]> {
  const tenant = tenantId(tid);
  const db = getIamDb();
  const due = await db
    .select({ assignment: assignTable, plan: planTable })
    .from(assignTable)
    .innerJoin(planTable, eq(assignTable.planId, planTable.id))
    .where(and(eq(assignTable.tenantId, tenant), eq(assignTable.status, "active"), lte(assignTable.periodEnd, now)));

  const results: RolloverResult[] = [];
  for (const { assignment, plan } of due) {
    const rolloverKey = `${assignment.id}:${assignment.periodEnd.toISOString()}`;
    if (assignment.lastRolloverKey === rolloverKey) {
      results.push({
        assignmentId: assignment.id,
        scopeType: assignment.scopeType as PlanScopeType,
        scopeId: assignment.scopeId,
        archivedPeriod: poolPeriodKey(assignment.periodEnd),
        skipped: true,
      });
      continue;
    }

    const archivedPeriod = poolPeriodKey(assignment.periodEnd);
    await archivePoolLedger(tenant, assignment.scopeType as PlanScopeType, assignment.scopeId, archivedPeriod, rolloverKey);
    await resetPoolUsageForAssignment(tenant, assignment.scopeType as PlanScopeType, assignment.scopeId, archivedPeriod);

    const nextPlanId = assignment.pendingPlanId ?? assignment.planId;
    const nextPlan = await getQuotaPlan(nextPlanId, tenant);
    const periodType = normalizePlanPeriod(nextPlan?.period ?? plan.period);
    const nextBounds = computeNextPeriodBounds(periodType, assignment.periodEnd);

    await db
      .update(assignTable)
      .set({
        planId: nextPlanId,
        pendingPlanId: null,
        periodStart: nextBounds.start,
        periodEnd: nextBounds.end,
        lastRolloverKey: rolloverKey,
        updatedAt: new Date(),
      })
      .where(eq(assignTable.id, assignment.id));

    results.push({
      assignmentId: assignment.id,
      scopeType: assignment.scopeType as PlanScopeType,
      scopeId: assignment.scopeId,
      archivedPeriod,
    });
  }

  if (results.some((r) => !r.skipped)) {
    await rebuildQuotaMappingFromPlans(tenant);
  }
  return results;
}
