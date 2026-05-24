/**
 * Personal Access Token (PAT) lifecycle for Enterprise Gateway.
 */

import { apiTokens as patTable } from "@agenticx/db-schema";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getIamDb } from "./db";

export type PatStatus = "active" | "revoked" | "expired";

export type PatRecord = {
  id: number;
  tenantId: string;
  userId: string;
  deptId: string | null;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  status: PatStatus;
  expireAt: string | null;
  lastUsedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePatInput = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  name: string;
  createdBy: string;
  scopes?: string[];
  expireDays?: number;
};

export type CreatePatResult = {
  record: PatRecord;
  token: string;
};

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(bytes: Buffer): string {
  let out = "";
  for (const b of bytes) {
    out += BASE62[b % BASE62.length];
  }
  return out;
}

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function defaultExpireDays(): number {
  const raw = process.env.PAT_DEFAULT_EXPIRE_DAYS?.trim();
  const n = raw ? Number(raw) : 90;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

function rowToRecord(row: typeof patTable.$inferSelect): PatRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    deptId: row.deptId ?? null,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    status: (row.status as PatStatus) || "active",
    expireAt: row.expireAt ? row.expireAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export function generatePatPlaintext(): string {
  return `agx-pat-${toBase62(randomBytes(24))}`;
}

export async function createPat(input: CreatePatInput): Promise<CreatePatResult> {
  const db = getIamDb();
  const plain = generatePatPlaintext();
  const tokenHash = hashToken(plain);
  const tokenPrefix = plain.slice(0, 12);
  const days = input.expireDays ?? defaultExpireDays();
  const expireAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const scopes = input.scopes?.length ? input.scopes : ["workspace:chat"];

  const inserted = await db
    .insert(patTable)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      deptId: input.deptId ?? null,
      name: input.name.trim(),
      tokenHash,
      tokenPrefix,
      scopes,
      status: "active",
      expireAt,
      createdBy: input.createdBy,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("create pat failed");
  return { record: rowToRecord(row), token: plain };
}

export async function listPats(filter: {
  tenantId: string;
  userId?: string;
}): Promise<PatRecord[]> {
  const db = getIamDb();
  const cond = filter.userId
    ? and(eq(patTable.tenantId, filter.tenantId), eq(patTable.userId, filter.userId))
    : eq(patTable.tenantId, filter.tenantId);
  const rows = await db.select().from(patTable).where(cond).orderBy(desc(patTable.createdAt));
  return rows.map(rowToRecord);
}

export async function revokePat(id: number, tenantId: string): Promise<PatRecord | null> {
  const db = getIamDb();
  const updated = await db
    .update(patTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(patTable.id, id), eq(patTable.tenantId, tenantId)))
    .returning();
  return updated[0] ? rowToRecord(updated[0]) : null;
}

export type VerifyPatResult = {
  id: number;
  tenantId: string;
  userId: string;
  deptId: string | null;
  scopes: string[];
  status: PatStatus;
};

export async function verifyPat(plain: string): Promise<VerifyPatResult | null> {
  if (!plain.startsWith("agx-pat-")) return null;
  const db = getIamDb();
  const tokenHash = hashToken(plain);
  const rows = await db.select().from(patTable).where(eq(patTable.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.status === "revoked") return null;
  if (row.expireAt && row.expireAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    deptId: row.deptId ?? null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    status: (row.status as PatStatus) || "active",
  };
}

export async function touchPatLastUsed(id: number): Promise<void> {
  const db = getIamDb();
  await db.update(patTable).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(patTable.id, id));
}

export { hashToken as patHashToken };
