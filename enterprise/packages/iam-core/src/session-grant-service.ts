import { enterpriseRuntimePatRevocation, sessionGrants as grantTable } from "@agenticx/db-schema";
import { getIamDb } from "./db";
import { resolveDatabaseConfig } from "./database/config";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  activeMysqlSessionGrants,
  insertMysqlSessionGrant,
  listMysqlSessionGrants,
  revokeMysqlSessionGrant,
} from "./repos/mysql/session-grants";

export type SessionGrantRecord = {
  id: string;
  tenantId: string;
  sessionId: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string | null;
  description: string | null;
  createdAt: string;
};

export type CreateSessionGrantInput = {
  tenantId: string;
  sessionId: string;
  scopes: string[];
  ttlSeconds: number;
  createdBy?: string;
  description?: string;
};

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for session grants.");
  return t;
}

function rowToRecord(row: typeof grantTable.$inferSelect): SessionGrantRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdBy: row.createdBy ?? null,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createSessionGrant(input: CreateSessionGrantInput): Promise<SessionGrantRecord> {
  const ttl = Math.max(1, Math.floor(input.ttlSeconds));
  const id = `sg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const scopes = input.scopes?.length ? input.scopes : ["workspace:chat"];
  if (resolveDatabaseConfig().dialect === "mysql") {
    return insertMysqlSessionGrant({
      id,
      tenantId: input.tenantId,
      sessionId: input.sessionId.trim(),
      scopes,
      expiresAt,
      createdBy: input.createdBy ?? null,
      description: input.description?.trim() || null,
    });
  }
  const db = getIamDb();
  const inserted = await db
    .insert(grantTable)
    .values({
      id,
      tenantId: input.tenantId,
      sessionId: input.sessionId.trim(),
      scopes,
      expiresAt,
      createdBy: input.createdBy ?? null,
      description: input.description?.trim() || null,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("create session grant failed");
  return rowToRecord(row);
}

export async function listSessionGrants(limit = 50): Promise<SessionGrantRecord[]> {
  const tid = tenant();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  if (resolveDatabaseConfig().dialect === "mysql") {
    return listMysqlSessionGrants(tid, safeLimit);
  }
  const db = getIamDb();
  const rows = await db
    .select()
    .from(grantTable)
    .where(eq(grantTable.tenantId, tid))
    .orderBy(desc(grantTable.createdAt))
    .limit(safeLimit);
  return rows.map(rowToRecord);
}

export async function revokeSessionGrant(id: string): Promise<SessionGrantRecord | null> {
  const tid = tenant();
  if (resolveDatabaseConfig().dialect === "mysql") {
    return revokeMysqlSessionGrant(id, tid);
  }
  const db = getIamDb();
  const updated = await db
    .update(grantTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(grantTable.id, id), eq(grantTable.tenantId, tid)))
    .returning();
  return updated[0] ? rowToRecord(updated[0]) : null;
}

export async function buildSessionGrantsSnapshotForGateway(): Promise<{
  updatedAt: string;
  grants: Record<string, string[]>;
}> {
  const tid = tenant();
  const now = new Date();
  if (resolveDatabaseConfig().dialect === "mysql") {
    const rows = await activeMysqlSessionGrants(tid, now);
    const grants: Record<string, string[]> = {};
    for (const row of rows) {
      if (row.scopes.length) grants[row.sessionId] = row.scopes;
    }
    return { updatedAt: now.toISOString(), grants };
  }
  const db = getIamDb();
  const rows = await db
    .select()
    .from(grantTable)
    .where(
      and(
        eq(grantTable.tenantId, tid),
        isNull(grantTable.revokedAt),
        gt(grantTable.expiresAt, now)
      )
    );
  const grants: Record<string, string[]> = {};
  for (const row of rows) {
    const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
    if (!scopes.length) continue;
    grants[row.sessionId] = scopes;
  }
  return { updatedAt: now.toISOString(), grants };
}
