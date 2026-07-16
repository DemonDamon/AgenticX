import { enterpriseRuntimeCompliance } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import type { ComplianceStore } from "../postgresql/compliance";
import type { CrossBorderAction } from "../../compliance-service";
import { getMysqlRepositoryDb } from "./db";

export const mysqlComplianceStore: ComplianceStore = {
  async get(tenantId) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
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
    const db = await getMysqlRepositoryDb();
    const now = new Date();
    await db
      .insert(enterpriseRuntimeCompliance)
      .values({ ...input, updatedAt: now })
      .onDuplicateKeyUpdate({
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
