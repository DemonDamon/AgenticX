import { maScheduleRuns, maSchedules } from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

type ScheduleInsert = typeof maSchedules.$inferInsert;
type SchedulePatch = Partial<ScheduleInsert>;

export async function mysqlListMaSchedules(tenantId: string, agentId?: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maSchedules)
    .where(and(eq(maSchedules.tenantId, tenantId), agentId ? eq(maSchedules.agentId, agentId) : undefined))
    .orderBy(asc(maSchedules.name));
}

export async function mysqlFindMaSchedule(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maSchedules)
    .where(and(eq(maSchedules.tenantId, tenantId), eq(maSchedules.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaScheduleByName(tenantId: string, name: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maSchedules)
    .where(and(eq(maSchedules.tenantId, tenantId), eq(maSchedules.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertMaSchedule(row: ScheduleInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(maSchedules).values(row);
}

export async function mysqlUpdateMaSchedule(tenantId: string, id: string, patch: SchedulePatch): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.update(maSchedules).set(patch).where(and(eq(maSchedules.tenantId, tenantId), eq(maSchedules.id, id)));
}

export async function mysqlDeleteMaSchedule(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(maSchedules).where(and(eq(maSchedules.tenantId, tenantId), eq(maSchedules.id, id)));
}

export async function mysqlCountMaSchedules(tenantId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db.select({ n: sql<number>`count(*)` }).from(maSchedules).where(eq(maSchedules.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

export async function mysqlListEnabledMaSchedules() {
  const db = await getMysqlRepositoryDb();
  return db.select().from(maSchedules).where(eq(maSchedules.enabled, true));
}

export async function mysqlListDisabledMaScheduleIds(): Promise<string[]> {
  const db = await getMysqlRepositoryDb();
  const rows = await db.select({ id: maSchedules.id }).from(maSchedules).where(eq(maSchedules.enabled, false));
  return rows.map((row) => row.id);
}

export async function mysqlListMaScheduleRuns(tenantId: string, scheduleId: string, limit: number) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maScheduleRuns)
    .where(and(eq(maScheduleRuns.tenantId, tenantId), eq(maScheduleRuns.scheduleId, scheduleId)))
    .orderBy(desc(maScheduleRuns.scheduledFor))
    .limit(limit);
}

export async function mysqlListMaScheduleRunsForIds(tenantId: string, scheduleIds: string[]) {
  if (scheduleIds.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maScheduleRuns)
    .where(and(eq(maScheduleRuns.tenantId, tenantId), inArray(maScheduleRuns.scheduleId, scheduleIds)));
}
