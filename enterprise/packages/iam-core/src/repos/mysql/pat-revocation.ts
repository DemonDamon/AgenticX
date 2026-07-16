import { enterpriseRuntimePatRevocation } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import type { PatRevocationSnapshot } from "../../pat-revocation-store";
import { getMysqlRepositoryDb } from "./db";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function readMysqlPatRevocation(tenantId: string): Promise<PatRevocationSnapshot | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimePatRevocation)
    .where(eq(enterpriseRuntimePatRevocation.tenantId, tenantId))
    .limit(1);
  return row
    ? {
        version: Number(row.version),
        revokedHashes: stringArray(row.revokedHashes),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

export async function writeMysqlPatRevocation(
  tenantId: string,
  version: number,
  revokedHashes: string[],
  updatedAt: Date,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .insert(enterpriseRuntimePatRevocation)
    .values({ tenantId, version: String(version), revokedHashes, updatedAt })
    .onDuplicateKeyUpdate({
      set: { version: String(version), revokedHashes, updatedAt },
    });
}
