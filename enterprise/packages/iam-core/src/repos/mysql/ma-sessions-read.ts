import { maSessionEvents, maSessions, maWorkItems } from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, gt, gte, inArray, lt, type SQL } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlListMaSessions(
  tenantId: string,
  filter: {
    agentId?: string;
    userId?: string;
    status?: string;
    source?: string;
    beforeId?: string;
    limit: number;
    createdFrom?: Date | null;
    createdTo?: Date | null;
  },
) {
  const db = await getMysqlRepositoryDb();
  const filters: SQL[] = [eq(maSessions.tenantId, tenantId)];
  if (filter.agentId) filters.push(eq(maSessions.agentId, filter.agentId));
  if (filter.userId) filters.push(eq(maSessions.createdByUserId, filter.userId));
  if (filter.status) filters.push(eq(maSessions.status, filter.status));
  if (filter.source) filters.push(eq(maSessions.source, filter.source));
  if (filter.beforeId) filters.push(lt(maSessions.id, filter.beforeId));
  if (filter.createdFrom) filters.push(gte(maSessions.createdAt, filter.createdFrom));
  if (filter.createdTo) filters.push(lt(maSessions.createdAt, filter.createdTo));
  return db
    .select()
    .from(maSessions)
    .where(and(...filters))
    .orderBy(desc(maSessions.id))
    .limit(filter.limit);
}

export async function mysqlFindMaSession(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maSessions)
    .where(and(eq(maSessions.tenantId, tenantId), eq(maSessions.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlListMaSessionEvents(
  tenantId: string,
  sessionId: string,
  opts: { afterSeq: number; limit: number; types: string[] },
) {
  const db = await getMysqlRepositoryDb();
  const filters: SQL[] = [
    eq(maSessionEvents.tenantId, tenantId),
    eq(maSessionEvents.sessionId, sessionId),
    gt(maSessionEvents.seq, opts.afterSeq),
  ];
  if (opts.types.length > 0) filters.push(inArray(maSessionEvents.type, opts.types));
  return db
    .select()
    .from(maSessionEvents)
    .where(and(...filters))
    .orderBy(asc(maSessionEvents.seq))
    .limit(opts.limit);
}

export async function mysqlListMaWorkItems(tenantId: string, sessionId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maWorkItems)
    .where(and(eq(maWorkItems.tenantId, tenantId), eq(maWorkItems.sessionId, sessionId)))
    .orderBy(asc(maWorkItems.createdAt));
}
