/**
 * admin-console · ECP E4 租户分发策略（MySQL）
 */

import { DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY, normalizeEcpTenantDistributionPolicy } from "@agenticx/config";
import { ecpTenantSettings } from "@agenticx/db-schema/mysql";
import { createMysqlDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

export type EcpTenantDistributionPolicyRecord = {
  tenantId: string;
  installCopyEnabled: boolean;
};

async function getSettingsDb() {
  const database = resolveDatabaseConfig();
  if (database.dialect !== "mysql") {
    throw new Error("Tenant distribution settings requested from the wrong database dialect.");
  }
  return (await createMysqlDb(database)).raw;
}

export async function getEcpTenantDistributionPolicy(
  tenantId: string,
): Promise<EcpTenantDistributionPolicyRecord> {
  const db = await getSettingsDb();
  const rows = await db
    .select()
    .from(ecpTenantSettings)
    .where(eq(ecpTenantSettings.tenantId, tenantId))
    .limit(1);
  const normalized = normalizeEcpTenantDistributionPolicy(
    rows[0]
      ? { installCopyEnabled: rows[0].installCopyEnabled }
      : DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY,
  );
  return { tenantId, installCopyEnabled: normalized.installCopyEnabled };
}

export async function updateEcpTenantDistributionPolicy(
  tenantId: string,
  input: { installCopyEnabled?: boolean },
): Promise<EcpTenantDistributionPolicyRecord> {
  const db = await getSettingsDb();
  const existing = await getEcpTenantDistributionPolicy(tenantId);
  const installCopyEnabled =
    input.installCopyEnabled === undefined ? existing.installCopyEnabled : input.installCopyEnabled === true;
  const now = new Date();
  const rows = await db
    .select({ tenantId: ecpTenantSettings.tenantId })
    .from(ecpTenantSettings)
    .where(eq(ecpTenantSettings.tenantId, tenantId))
    .limit(1);
  if (rows[0]) {
    await db
      .update(ecpTenantSettings)
      .set({ installCopyEnabled, updatedAt: now })
      .where(eq(ecpTenantSettings.tenantId, tenantId));
  } else {
    await db.insert(ecpTenantSettings).values({
      tenantId,
      installCopyEnabled,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { tenantId, installCopyEnabled };
}
