import { maAgentQuotas } from "@agenticx/db-schema/mysql";
import { and, asc, eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListMaAgentQuotas(tenantId: string, agentId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maAgentQuotas)
    .where(and(eq(maAgentQuotas.tenantId, tenantId), eq(maAgentQuotas.agentId, agentId)))
    .orderBy(asc(maAgentQuotas.createdAt), asc(maAgentQuotas.id));
}

export async function mysqlFindMaAgentQuotaBySubject(tenantId: string, agentId: string, subjectKey: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maAgentQuotas)
    .where(
      and(
        eq(maAgentQuotas.tenantId, tenantId),
        eq(maAgentQuotas.agentId, agentId),
        eq(maAgentQuotas.subjectKey, subjectKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaAgentQuota(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maAgentQuotas)
    .where(and(eq(maAgentQuotas.tenantId, tenantId), eq(maAgentQuotas.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertMaAgentQuota(row: typeof maAgentQuotas.$inferInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(maAgentQuotas).values(row);
}

export async function mysqlUpdateMaAgentQuota(
  tenantId: string,
  id: string,
  patch: Partial<typeof maAgentQuotas.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(maAgentQuotas)
    .set(patch)
    .where(and(eq(maAgentQuotas.tenantId, tenantId), eq(maAgentQuotas.id, id)));
}

export async function mysqlDeleteMaAgentQuota(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(maAgentQuotas).where(and(eq(maAgentQuotas.tenantId, tenantId), eq(maAgentQuotas.id, id)));
}
