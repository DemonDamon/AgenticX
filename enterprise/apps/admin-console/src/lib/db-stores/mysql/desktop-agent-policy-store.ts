import {
  normalizeDesktopAgentActionPolicy,
  type DesktopAgentActionPolicy,
} from "@agenticx/config";
import { enterpriseDesktopAgentPolicies as policyTable } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import { getAdminMysqlDb } from "./database";

export type DesktopAgentPolicyRecord = DesktopAgentActionPolicy & {
  updatedAt: string | null;
};

function tenant(): string {
  const value = process.env.DEFAULT_TENANT_ID?.trim();
  if (!value) throw new Error("DEFAULT_TENANT_ID is required for desktop agent policy.");
  return value;
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function recordFrom(policy: DesktopAgentActionPolicy, updatedAt: string | null): DesktopAgentPolicyRecord {
  return {
    deniedTools: policy.deniedTools,
    alwaysAskTools: policy.alwaysAskTools,
    disableSessionAllow: policy.disableSessionAllow,
    updatedAt,
  };
}

export async function getDesktopAgentPolicy(): Promise<DesktopAgentPolicyRecord> {
  const tenantId = tenant();
  const db = getAdminMysqlDb();
  const rows = await db.select().from(policyTable).where(eq(policyTable.tenantId, tenantId)).limit(1);
  const row = rows[0];
  if (!row) {
    return recordFrom(normalizeDesktopAgentActionPolicy(undefined), null);
  }
  return recordFrom(normalizeDesktopAgentActionPolicy(row.config), isoTimestamp(row.updatedAt));
}

export async function setDesktopAgentPolicy(input: unknown): Promise<DesktopAgentPolicyRecord> {
  const tenantId = tenant();
  const policy = normalizeDesktopAgentActionPolicy(input);
  const updatedAt = new Date();
  const config = {
    deniedTools: policy.deniedTools,
    alwaysAskTools: policy.alwaysAskTools,
    disableSessionAllow: policy.disableSessionAllow,
  };
  const db = getAdminMysqlDb();
  await db
    .insert(policyTable)
    .values({
      tenantId,
      config,
      updatedAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        config,
        updatedAt,
      },
    });
  return recordFrom(policy, updatedAt.toISOString());
}
