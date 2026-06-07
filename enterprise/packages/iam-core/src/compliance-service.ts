import { enterpriseRuntimeCompliance } from "@agenticx/db-schema";
import { eq } from "drizzle-orm";
import { getIamDb } from "./db";

export type CrossBorderAction = "allow" | "block" | "require_approval";

export type ComplianceConfig = {
  tenantId: string;
  dataResidency: string | null;
  crossBorderAction: CrossBorderAction;
  auditRetentionYears: number;
  appendOnly: boolean;
  updatedAt: string;
};

const DEFAULT_RETENTION_YEARS = 6;

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for compliance config.");
  return t;
}

function normalizeAction(raw: string | null | undefined): CrossBorderAction {
  const v = String(raw ?? "allow").trim().toLowerCase();
  if (v === "block" || v === "require_approval") return v;
  return "allow";
}

function rowToConfig(row: typeof enterpriseRuntimeCompliance.$inferSelect): ComplianceConfig {
  return {
    tenantId: row.tenantId,
    dataResidency: row.dataResidency ?? null,
    crossBorderAction: normalizeAction(row.crossBorderAction),
    auditRetentionYears: row.auditRetentionYears ?? DEFAULT_RETENTION_YEARS,
    appendOnly: row.appendOnly ?? true,
    updatedAt:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? new Date().toISOString()),
  };
}

export async function getComplianceConfig(tenantId?: string): Promise<ComplianceConfig> {
  const tid = tenantId?.trim() || requiredTenantId();
  const db = getIamDb();
  const rows = await db
    .select()
    .from(enterpriseRuntimeCompliance)
    .where(eq(enterpriseRuntimeCompliance.tenantId, tid))
    .limit(1);
  if (!rows.length) {
    return {
      tenantId: tid,
      dataResidency: null,
      crossBorderAction: "allow",
      auditRetentionYears: DEFAULT_RETENTION_YEARS,
      appendOnly: true,
      updatedAt: new Date().toISOString(),
    };
  }
  return rowToConfig(rows[0]!);
}

export async function upsertComplianceConfig(input: {
  tenantId?: string;
  dataResidency?: string | null;
  crossBorderAction?: CrossBorderAction;
  auditRetentionYears?: number;
  appendOnly?: boolean;
}): Promise<ComplianceConfig> {
  const tid = input.tenantId?.trim() || requiredTenantId();
  const db = getIamDb();
  const years = Math.max(1, Math.min(99, input.auditRetentionYears ?? DEFAULT_RETENTION_YEARS));
  const now = new Date();
  await db
    .insert(enterpriseRuntimeCompliance)
    .values({
      tenantId: tid,
      dataResidency: input.dataResidency?.trim() || null,
      crossBorderAction: normalizeAction(input.crossBorderAction),
      auditRetentionYears: years,
      appendOnly: input.appendOnly ?? true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: enterpriseRuntimeCompliance.tenantId,
      set: {
        dataResidency: input.dataResidency?.trim() || null,
        crossBorderAction: normalizeAction(input.crossBorderAction),
        auditRetentionYears: years,
        appendOnly: input.appendOnly ?? true,
        updatedAt: now,
      },
    });
  return getComplianceConfig(tid);
}

/** 审计查询/导出最早可见时间（HIPAA 式留存下限）。 */
export async function getAuditRetentionCutoff(tenantId: string): Promise<Date | null> {
  const cfg = await getComplianceConfig(tenantId);
  const years = cfg.auditRetentionYears;
  if (!years || years <= 0) return null;
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

export async function buildComplianceSnapshotForGateway(tenantId?: string): Promise<{
  updatedAt: string;
  items: Array<{
    tenantId: string;
    dataResidency: string | null;
    crossBorderAction: CrossBorderAction;
  }>;
}> {
  const cfg = await getComplianceConfig(tenantId);
  return {
    updatedAt: cfg.updatedAt,
    items: [
      {
        tenantId: cfg.tenantId,
        dataResidency: cfg.dataResidency,
        crossBorderAction: cfg.crossBorderAction,
      },
    ],
  };
}
