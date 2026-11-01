/**
 * admin-console · ECP E4 租户分发策略（PG）
 */

import { DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY, normalizeEcpTenantDistributionPolicy } from "@agenticx/config";
import { ecpTenantSettings } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { eq } from "drizzle-orm";

export type EcpTenantDistributionPolicyRecord = {
  tenantId: string;
  installCopyEnabled: boolean;
};

export async function getEcpTenantDistributionPolicy(
  tenantId: string,
): Promise<EcpTenantDistributionPolicyRecord> {
  const db = getIamDb();
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
  const db = getIamDb();
  const existing = await getEcpTenantDistributionPolicy(tenantId);
  const installCopyEnabled =
    input.installCopyEnabled === undefined ? existing.installCopyEnabled : input.installCopyEnabled === true;
  const now = new Date();
  await db
    .insert(ecpTenantSettings)
    .values({
      tenantId,
      installCopyEnabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ecpTenantSettings.tenantId,
      set: { installCopyEnabled, updatedAt: now },
    });
  return { tenantId, installCopyEnabled };
}
