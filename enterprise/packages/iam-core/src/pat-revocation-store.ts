import { enterpriseRuntimePatRevocation } from "@agenticx/db-schema";
import { createHash } from "node:crypto";
import { getIamDb } from "./db";
import { eq } from "drizzle-orm";
import { resolveDatabaseConfig } from "./database/config";
import {
  readMysqlPatRevocation,
  writeMysqlPatRevocation,
} from "./repos/mysql/pat-revocation";

export type PatRevocationSnapshot = {
  version: number;
  revokedHashes: string[];
  updatedAt: string;
};

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for PAT revocation.");
  return t;
}

async function ensureRevocationRow(tid: string) {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const existing = await readMysqlPatRevocation(tid);
    if (!existing) await writeMysqlPatRevocation(tid, 0, [], new Date());
    return;
  }
  const db = getIamDb();
  const existing = await db
    .select()
    .from(enterpriseRuntimePatRevocation)
    .where(eq(enterpriseRuntimePatRevocation.tenantId, tid))
    .limit(1);
  if (existing.length) return;
  await db.insert(enterpriseRuntimePatRevocation).values({
    tenantId: tid,
    version: "0",
    revokedHashes: [],
  });
}

export async function recordPatRevocation(tokenHash: string): Promise<PatRevocationSnapshot> {
  const tid = tenant();
  const hash = tokenHash.trim();
  if (!hash) throw new Error("token hash required");
  await ensureRevocationRow(tid);
  if (resolveDatabaseConfig().dialect === "mysql") {
    const current = await readMysqlPatRevocation(tid);
    const prevHashes = current?.revokedHashes ?? [];
    const nextHashes = prevHashes.includes(hash) ? prevHashes : [...prevHashes, hash].slice(-5000);
    const nextVersion = (current?.version ?? 0) + 1;
    const now = new Date();
    await writeMysqlPatRevocation(tid, nextVersion, nextHashes, now);
    return { version: nextVersion, revokedHashes: nextHashes, updatedAt: now.toISOString() };
  }
  const db = getIamDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimePatRevocation)
    .where(eq(enterpriseRuntimePatRevocation.tenantId, tid))
    .limit(1);
  const prevHashes = Array.isArray(row?.revokedHashes) ? row!.revokedHashes.map(String) : [];
  const nextHashes = prevHashes.includes(hash) ? prevHashes : [...prevHashes, hash].slice(-5000);
  const nextVersion = Number(row?.version ?? 0) + 1;
  const now = new Date();
  await db
    .insert(enterpriseRuntimePatRevocation)
    .values({
      tenantId: tid,
      version: String(nextVersion),
      revokedHashes: nextHashes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: enterpriseRuntimePatRevocation.tenantId,
      set: {
        version: String(nextVersion),
        revokedHashes: nextHashes,
        updatedAt: now,
      },
    });
  return {
    version: nextVersion,
    revokedHashes: nextHashes,
    updatedAt: now.toISOString(),
  };
}

export async function buildPatRevocationSnapshotForGateway(): Promise<PatRevocationSnapshot> {
  const tid = tenant();
  await ensureRevocationRow(tid);
  if (resolveDatabaseConfig().dialect === "mysql") {
    return (await readMysqlPatRevocation(tid)) ?? {
      version: 0,
      revokedHashes: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const db = getIamDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimePatRevocation)
    .where(eq(enterpriseRuntimePatRevocation.tenantId, tid))
    .limit(1);
  return {
    version: Number(row?.version ?? 0),
    revokedHashes: Array.isArray(row?.revokedHashes) ? row!.revokedHashes.map(String) : [],
    updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
  };
}

export async function recordPatRevocationByPlaintext(plain: string): Promise<PatRevocationSnapshot> {
  const hash = createHash("sha256").update(plain, "utf8").digest("hex");
  return recordPatRevocation(hash);
}
