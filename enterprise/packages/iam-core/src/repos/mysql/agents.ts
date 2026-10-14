import { enterpriseAgents } from "@agenticx/db-schema/mysql";
import { and, desc, eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

type AgentStatus = "active" | "disabled";

export async function mysqlListAgents(tenantId: string, status?: AgentStatus) {
  const db = await getMysqlRepositoryDb();
  const where = status
    ? and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.status, status))
    : eq(enterpriseAgents.tenantId, tenantId);
  return db.select().from(enterpriseAgents).where(where).orderBy(desc(enterpriseAgents.updatedAt));
}

export async function mysqlFindAgent(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(enterpriseAgents)
    .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindAgentBySlug(tenantId: string, slug: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(enterpriseAgents)
    .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertAgent(row: typeof enterpriseAgents.$inferInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(enterpriseAgents).values(row);
}

export async function mysqlUpdateAgent(
  tenantId: string,
  id: string,
  patch: Partial<typeof enterpriseAgents.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(enterpriseAgents)
    .set(patch)
    .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.id, id)));
}

export async function mysqlDeleteAgent(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .delete(enterpriseAgents)
    .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.id, id)));
}
