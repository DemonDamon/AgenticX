import { enterpriseAgents, maEnvironments, maSessions, maWorkItems } from "@agenticx/db-schema/mysql";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListMaEnvironments(
  tenantId: string,
  opts?: { status?: string; type?: string },
) {
  const db = await getMysqlRepositoryDb();
  const filters = [eq(maEnvironments.tenantId, tenantId)];
  if (opts?.status) filters.push(eq(maEnvironments.status, opts.status));
  if (opts?.type) filters.push(eq(maEnvironments.type, opts.type));
  return db
    .select()
    .from(maEnvironments)
    .where(and(...filters))
    .orderBy(asc(maEnvironments.name));
}

export async function mysqlFindMaEnvironment(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maEnvironments)
    .where(and(eq(maEnvironments.tenantId, tenantId), eq(maEnvironments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaEnvironmentByLowerName(tenantId: string, name: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maEnvironments)
    .where(and(eq(maEnvironments.tenantId, tenantId), sql`lower(${maEnvironments.name}) = ${name.toLowerCase()}`))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertMaEnvironment(row: typeof maEnvironments.$inferInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(maEnvironments).values(row);
}

export async function mysqlUpdateMaEnvironment(
  tenantId: string,
  id: string,
  patch: Partial<typeof maEnvironments.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(maEnvironments)
    .set(patch)
    .where(and(eq(maEnvironments.tenantId, tenantId), eq(maEnvironments.id, id)));
}

export async function mysqlDeleteMaEnvironment(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(maEnvironments).where(and(eq(maEnvironments.tenantId, tenantId), eq(maEnvironments.id, id)));
}

async function countOf(
  query: Promise<Array<{ n: unknown }>>,
): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0) || 0;
}

export async function mysqlCountMaEnvironmentReferences(
  tenantId: string,
  id: string,
): Promise<{ agents: number; activeSessions: number; openWorkItems: number }> {
  const db = await getMysqlRepositoryDb();
  const agents = await countOf(
    db
      .select({ n: sql<number>`count(*)` })
      .from(enterpriseAgents)
      .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.defaultEnvironmentId, id))),
  );
  const activeSessions = await countOf(
    db
      .select({ n: sql<number>`count(*)` })
      .from(maSessions)
      .where(
        and(
          eq(maSessions.tenantId, tenantId),
          eq(maSessions.environmentId, id),
          notInArray(maSessions.status, ["terminated", "archived"]),
        ),
      ),
  );
  const openWorkItems = await countOf(
    db
      .select({ n: sql<number>`count(*)` })
      .from(maWorkItems)
      .where(
        and(
          eq(maWorkItems.tenantId, tenantId),
          eq(maWorkItems.environmentId, id),
          inArray(maWorkItems.status, ["queued", "claimed", "running"]),
        ),
      ),
  );
  return { agents, activeSessions, openWorkItems };
}
