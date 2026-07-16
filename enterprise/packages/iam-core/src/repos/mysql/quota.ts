import {
  enterpriseRuntimeTokenQuotas,
  gatewayQuotaPoolUsage,
} from "@agenticx/db-schema/mysql";
import { and, eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function loadMysqlQuotaConfig(tenantId: string): Promise<Record<string, unknown> | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select({ config: enterpriseRuntimeTokenQuotas.config })
    .from(enterpriseRuntimeTokenQuotas)
    .where(eq(enterpriseRuntimeTokenQuotas.tenantId, tenantId))
    .limit(1);
  return row?.config ?? null;
}

export async function readMysqlQuotaUsage(
  tenantId: string,
  scopeType: string,
  scopeId: string,
  period: string,
): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select({ usedTotal: gatewayQuotaPoolUsage.usedTotal })
    .from(gatewayQuotaPoolUsage)
    .where(and(
      eq(gatewayQuotaPoolUsage.tenantId, tenantId),
      eq(gatewayQuotaPoolUsage.scopeType, scopeType),
      eq(gatewayQuotaPoolUsage.scopeId, scopeId),
      eq(gatewayQuotaPoolUsage.period, period),
    ))
    .limit(1);
  return row?.usedTotal ?? 0;
}
