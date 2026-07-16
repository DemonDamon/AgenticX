import { apiTokens } from "@agenticx/db-schema/mysql";
import { and, desc, eq } from "drizzle-orm";

import type { PatRecord, PatStatus, VerifyPatResult } from "../../pat-service";
import { getMysqlRepositoryDb } from "./db";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toRecord(row: typeof apiTokens.$inferSelect): PatRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    deptId: row.deptId ?? null,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: stringArray(row.scopes),
    status: (row.status as PatStatus) || "active",
    expireAt: row.expireAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createMysqlPatRow(input: {
  tenantId: string;
  userId: string;
  deptId: string | null;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: string[];
  expireAt: Date;
  createdBy: string;
}): Promise<PatRecord> {
  const db = await getMysqlRepositoryDb();
  await db.insert(apiTokens).values({ ...input, status: "active" });
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, input.tokenHash))
    .limit(1);
  if (!row) throw new Error("create pat failed");
  return toRecord(row);
}

export async function listMysqlPats(
  tenantId: string,
  userId?: string,
): Promise<PatRecord[]> {
  const db = await getMysqlRepositoryDb();
  const condition = userId
    ? and(eq(apiTokens.tenantId, tenantId), eq(apiTokens.userId, userId))
    : eq(apiTokens.tenantId, tenantId);
  const rows = await db
    .select()
    .from(apiTokens)
    .where(condition)
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toRecord);
}

export async function revokeMysqlPat(
  id: number,
  tenantId: string,
): Promise<{ record: PatRecord; tokenHash: string } | null> {
  const db = await getMysqlRepositoryDb();
  const [existing] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.tenantId, tenantId)))
    .limit(1);
  if (!existing) return null;
  await db
    .update(apiTokens)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.tenantId, tenantId)));
  const [updated] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.tenantId, tenantId)))
    .limit(1);
  return updated ? { record: toRecord(updated), tokenHash: existing.tokenHash } : null;
}

export async function verifyMysqlPat(tokenHash: string): Promise<VerifyPatResult | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row || row.status === "revoked") return null;
  if (row.expireAt && row.expireAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    deptId: row.deptId ?? null,
    scopes: stringArray(row.scopes),
    status: (row.status as PatStatus) || "active",
  };
}

export async function touchMysqlPatLastUsed(id: number): Promise<void> {
  const db = await getMysqlRepositoryDb();
  const now = new Date();
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(apiTokens.id, id));
}
