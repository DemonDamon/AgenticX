import { enterpriseRuntimeSessionRevocation } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import type { SessionRevocationSnapshot } from "../../session-revocation-store";
import { getMysqlRepositoryDb } from "./db";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function readMysqlSessionRevocation(
  tenantId: string,
): Promise<SessionRevocationSnapshot | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimeSessionRevocation)
    .where(eq(enterpriseRuntimeSessionRevocation.tenantId, tenantId))
    .limit(1);
  return row
    ? {
        version: Number(row.version),
        revokedSessionIds: stringArray(row.revokedSessionIds),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

export async function writeMysqlSessionRevocation(
  tenantId: string,
  version: number,
  revokedSessionIds: string[],
  updatedAt: Date,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .insert(enterpriseRuntimeSessionRevocation)
    .values({ tenantId, version: String(version), revokedSessionIds, updatedAt })
    .onDuplicateKeyUpdate({
      set: { version: String(version), revokedSessionIds, updatedAt },
    });
}
