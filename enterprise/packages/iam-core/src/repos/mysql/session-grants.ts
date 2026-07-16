import { sessionGrants } from "@agenticx/db-schema/mysql";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import type { SessionGrantRecord } from "../../session-grant-service";
import { getMysqlRepositoryDb } from "./db";

function scopes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toRecord(row: typeof sessionGrants.$inferSelect): SessionGrantRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    scopes: scopes(row.scopes),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdBy: row.createdBy ?? null,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertMysqlSessionGrant(values: typeof sessionGrants.$inferInsert): Promise<SessionGrantRecord> {
  const db = await getMysqlRepositoryDb();
  await db.insert(sessionGrants).values(values);
  const [row] = await db.select().from(sessionGrants).where(eq(sessionGrants.id, values.id)).limit(1);
  if (!row) throw new Error("create session grant failed");
  return toRecord(row);
}

export async function listMysqlSessionGrants(tenantId: string, limit: number): Promise<SessionGrantRecord[]> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(sessionGrants)
    .where(eq(sessionGrants.tenantId, tenantId))
    .orderBy(desc(sessionGrants.createdAt))
    .limit(limit);
  return rows.map(toRecord);
}

export async function revokeMysqlSessionGrant(id: string, tenantId: string): Promise<SessionGrantRecord | null> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(sessionGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessionGrants.id, id), eq(sessionGrants.tenantId, tenantId)));
  const [row] = await db
    .select()
    .from(sessionGrants)
    .where(and(eq(sessionGrants.id, id), eq(sessionGrants.tenantId, tenantId)))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function activeMysqlSessionGrants(
  tenantId: string,
  now: Date,
): Promise<Array<{ sessionId: string; scopes: string[] }>> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(sessionGrants)
    .where(and(
      eq(sessionGrants.tenantId, tenantId),
      isNull(sessionGrants.revokedAt),
      gt(sessionGrants.expiresAt, now),
    ));
  return rows.map((row) => ({ sessionId: row.sessionId, scopes: scopes(row.scopes) }));
}
