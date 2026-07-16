import { enterpriseRuntimeCompliance } from "@agenticx/db-schema";
import { eq } from "drizzle-orm";

import { getIamDb } from "../../db";
import type { ComplianceConfig, CrossBorderAction } from "../../compliance-service";

export interface ComplianceStore {
  get(tenantId: string): Promise<ComplianceConfig | null>;
  upsert(input: {
    tenantId: string;
    dataResidency: string | null;
    crossBorderAction: CrossBorderAction;
    auditRetentionYears: number;
    appendOnly: boolean;
  }): Promise<void>;
}

export const postgresqlComplianceStore: ComplianceStore = {
  async get(tenantId) {
    const [row] = await getIamDb()
      .select()
      .from(enterpriseRuntimeCompliance)
      .where(eq(enterpriseRuntimeCompliance.tenantId, tenantId))
      .limit(1);
    return row
      ? {
          tenantId: row.tenantId,
          dataResidency: row.dataResidency ?? null,
          crossBorderAction: row.crossBorderAction as CrossBorderAction,
          auditRetentionYears: row.auditRetentionYears,
          appendOnly: row.appendOnly,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;
  },
  async upsert(input) {
    const now = new Date();
    await getIamDb()
      .insert(enterpriseRuntimeCompliance)
      .values({ ...input, updatedAt: now })
      .onConflictDoUpdate({
        target: enterpriseRuntimeCompliance.tenantId,
        set: {
          dataResidency: input.dataResidency,
          crossBorderAction: input.crossBorderAction,
          auditRetentionYears: input.auditRetentionYears,
          appendOnly: input.appendOnly,
          updatedAt: now,
        },
      });
  },
};
