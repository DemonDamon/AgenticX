import { resolveDatabaseConfig } from "./database/config";
import { mysqlComplianceStore } from "./repos/mysql/compliance";
import {
  postgresqlComplianceStore,
  type ComplianceStore,
} from "./repos/postgresql/compliance";

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

function getComplianceStore(): ComplianceStore {
  return resolveDatabaseConfig().dialect === "mysql"
    ? mysqlComplianceStore
    : postgresqlComplianceStore;
}

export async function getComplianceConfig(tenantId?: string): Promise<ComplianceConfig> {
  const tid = tenantId?.trim() || requiredTenantId();
  const config = await getComplianceStore().get(tid);
  if (!config) {
    return {
      tenantId: tid,
      dataResidency: null,
      crossBorderAction: "allow",
      auditRetentionYears: DEFAULT_RETENTION_YEARS,
      appendOnly: true,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    ...config,
    crossBorderAction: normalizeAction(config.crossBorderAction),
    auditRetentionYears: config.auditRetentionYears ?? DEFAULT_RETENTION_YEARS,
  };
}

export async function upsertComplianceConfig(input: {
  tenantId?: string;
  dataResidency?: string | null;
  crossBorderAction?: CrossBorderAction;
  auditRetentionYears?: number;
  appendOnly?: boolean;
}): Promise<ComplianceConfig> {
  const tid = input.tenantId?.trim() || requiredTenantId();
  const years = Math.max(1, Math.min(99, input.auditRetentionYears ?? DEFAULT_RETENTION_YEARS));
  await getComplianceStore().upsert({
    tenantId: tid,
    dataResidency: input.dataResidency?.trim() || null,
    crossBorderAction: normalizeAction(input.crossBorderAction),
    auditRetentionYears: years,
    appendOnly: input.appendOnly ?? true,
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
