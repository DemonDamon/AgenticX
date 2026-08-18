import { enterpriseFeatureAssignments } from "@agenticx/db-schema/mysql";
import { and, eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListFeatureAssignments(tenantId: string, feature: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ assignmentKey: enterpriseFeatureAssignments.assignmentKey })
    .from(enterpriseFeatureAssignments)
    .where(
      and(
        eq(enterpriseFeatureAssignments.tenantId, tenantId),
        eq(enterpriseFeatureAssignments.feature, feature),
      ),
    );
}

export async function mysqlDeleteFeatureAssignments(tenantId: string, feature: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .delete(enterpriseFeatureAssignments)
    .where(
      and(
        eq(enterpriseFeatureAssignments.tenantId, tenantId),
        eq(enterpriseFeatureAssignments.feature, feature),
      ),
    );
}

export async function mysqlInsertFeatureAssignments(
  rows: Array<typeof enterpriseFeatureAssignments.$inferInsert>,
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getMysqlRepositoryDb();
  await db.insert(enterpriseFeatureAssignments).values(rows);
}
