import {
  enterpriseRuntimeTokenQuotas,
  enterpriseUserOptOuts,
} from "@agenticx/db-schema/mysql";
import { and, eq, inArray } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListOptOuts(tenantId: string, userId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ subject: enterpriseUserOptOuts.subject })
    .from(enterpriseUserOptOuts)
    .where(
      and(eq(enterpriseUserOptOuts.tenantId, tenantId), eq(enterpriseUserOptOuts.userId, userId)),
    );
}

export async function mysqlInsertOptOuts(
  rows: Array<typeof enterpriseUserOptOuts.$inferInsert>,
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getMysqlRepositoryDb();
  for (const row of rows) {
    await db
      .insert(enterpriseUserOptOuts)
      .values(row)
      .onDuplicateKeyUpdate({ set: { updatedAt: row.updatedAt ?? new Date() } });
  }
}

export async function mysqlDeleteOptOuts(
  tenantId: string,
  userId: string,
  subjects: readonly string[],
): Promise<void> {
  if (subjects.length === 0) return;
  const db = await getMysqlRepositoryDb();
  await db
    .delete(enterpriseUserOptOuts)
    .where(
      and(
        eq(enterpriseUserOptOuts.tenantId, tenantId),
        eq(enterpriseUserOptOuts.userId, userId),
        inArray(enterpriseUserOptOuts.subject, [...subjects]),
      ),
    );
}

export async function mysqlReadQuotaConfigRow(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ config: enterpriseRuntimeTokenQuotas.config })
    .from(enterpriseRuntimeTokenQuotas)
    .where(eq(enterpriseRuntimeTokenQuotas.tenantId, tenantId))
    .limit(1);
}

export async function mysqlListTenantOptOuts(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ userId: enterpriseUserOptOuts.userId, subject: enterpriseUserOptOuts.subject })
    .from(enterpriseUserOptOuts)
    .where(eq(enterpriseUserOptOuts.tenantId, tenantId));
}
