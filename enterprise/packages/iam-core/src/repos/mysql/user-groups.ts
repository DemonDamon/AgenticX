import {
  enterpriseRuntimeTokenQuotas,
  enterpriseRuntimeUserVisibleModels,
  enterpriseUserGroupMembers,
  enterpriseUserGroups,
  users,
} from "@agenticx/db-schema/mysql";
import { and, eq, inArray } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListUserGroups(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db.select().from(enterpriseUserGroups).where(eq(enterpriseUserGroups.tenantId, tenantId));
}

export async function mysqlListMembers(groupIds: readonly string[]) {
  if (groupIds.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(enterpriseUserGroupMembers)
    .where(inArray(enterpriseUserGroupMembers.groupId, [...groupIds]));
}

export async function mysqlListGroupIdsForUser(tenantId: string, userId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ groupId: enterpriseUserGroupMembers.groupId })
    .from(enterpriseUserGroupMembers)
    .innerJoin(enterpriseUserGroups, eq(enterpriseUserGroups.id, enterpriseUserGroupMembers.groupId))
    .where(
      and(eq(enterpriseUserGroups.tenantId, tenantId), eq(enterpriseUserGroupMembers.userId, userId)),
    );
}

export async function mysqlInsertUserGroup(
  row: typeof enterpriseUserGroups.$inferInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(enterpriseUserGroups).values(row);
}

export async function mysqlUpdateUserGroup(
  tenantId: string,
  id: string,
  patch: Partial<typeof enterpriseUserGroups.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(enterpriseUserGroups)
    .set(patch)
    .where(and(eq(enterpriseUserGroups.tenantId, tenantId), eq(enterpriseUserGroups.id, id)));
}

export async function mysqlDeleteUserGroup(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .delete(enterpriseUserGroups)
    .where(and(eq(enterpriseUserGroups.tenantId, tenantId), eq(enterpriseUserGroups.id, id)));
}

export async function mysqlReplaceMembers(
  groupId: string,
  rows: Array<typeof enterpriseUserGroupMembers.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(enterpriseUserGroupMembers).where(eq(enterpriseUserGroupMembers.groupId, groupId));
  if (rows.length === 0) return;
  await db.insert(enterpriseUserGroupMembers).values(rows);
}

export async function mysqlReadQuotaConfig(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ config: enterpriseRuntimeTokenQuotas.config })
    .from(enterpriseRuntimeTokenQuotas)
    .where(eq(enterpriseRuntimeTokenQuotas.tenantId, tenantId))
    .limit(1);
}

export async function mysqlListExistingUserIds(tenantId: string, candidateIds: readonly string[]) {
  if (candidateIds.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, [...candidateIds])));
}

export async function mysqlListVisibleModels(tenantId: string, keys: readonly string[]) {
  if (keys.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select({
      assignmentKey: enterpriseRuntimeUserVisibleModels.assignmentKey,
      modelId: enterpriseRuntimeUserVisibleModels.modelId,
    })
    .from(enterpriseRuntimeUserVisibleModels)
    .where(
      and(
        eq(enterpriseRuntimeUserVisibleModels.tenantId, tenantId),
        inArray(enterpriseRuntimeUserVisibleModels.assignmentKey, [...keys]),
      ),
    );
}

export async function mysqlReplaceVisibleModels(
  tenantId: string,
  assignmentKey: string,
  modelIds: readonly string[],
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .delete(enterpriseRuntimeUserVisibleModels)
    .where(
      and(
        eq(enterpriseRuntimeUserVisibleModels.tenantId, tenantId),
        eq(enterpriseRuntimeUserVisibleModels.assignmentKey, assignmentKey),
      ),
    );
  if (modelIds.length === 0) return;
  await db
    .insert(enterpriseRuntimeUserVisibleModels)
    .values(modelIds.map((modelId) => ({ tenantId, assignmentKey, modelId })));
}
