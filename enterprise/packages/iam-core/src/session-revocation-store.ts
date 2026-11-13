import { enterpriseRuntimeSessionRevocation } from "@agenticx/db-schema";
import { getIamDb } from "./db";
import { eq } from "drizzle-orm";
import { resolveDatabaseConfig } from "./database/config";
import {
  readMysqlSessionRevocation,
  writeMysqlSessionRevocation,
} from "./repos/mysql/session-revocation";

/**
 * SP5 incident-response：JWT session 吊销快照（pat-revocation-store 同款范式）。
 * 网关处置端点本地 InvalidateLocal 即时生效；本存储提供持久化吊销列表——网关
 * 经 GATEWAY_REMOTE_SESSION_REVOCATION_URL 轮询（重启恢复/多副本感知）。
 */

export type SessionRevocationSnapshot = {
  version: number;
  revokedSessionIds: string[];
  updatedAt: string;
};

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for session revocation.");
  return t;
}

async function ensureRevocationRow(tid: string) {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const existing = await readMysqlSessionRevocation(tid);
    if (!existing) await writeMysqlSessionRevocation(tid, 0, [], new Date());
    return;
  }
  const db = getIamDb();
  const existing = await db
    .select()
    .from(enterpriseRuntimeSessionRevocation)
    .where(eq(enterpriseRuntimeSessionRevocation.tenantId, tid))
    .limit(1);
  if (existing.length) return;
  await db.insert(enterpriseRuntimeSessionRevocation).values({
    tenantId: tid,
    version: "0",
    revokedSessionIds: [],
  });
}

export async function recordSessionRevocation(sessionId: string): Promise<SessionRevocationSnapshot> {
  const tid = tenant();
  const sid = sessionId.trim();
  if (!sid) throw new Error("session id required");
  await ensureRevocationRow(tid);
  if (resolveDatabaseConfig().dialect === "mysql") {
    const current = await readMysqlSessionRevocation(tid);
    const prevIds = current?.revokedSessionIds ?? [];
    const nextIds = prevIds.includes(sid) ? prevIds : [...prevIds, sid].slice(-5000);
    const nextVersion = (current?.version ?? 0) + 1;
    const now = new Date();
    await writeMysqlSessionRevocation(tid, nextVersion, nextIds, now);
    return { version: nextVersion, revokedSessionIds: nextIds, updatedAt: now.toISOString() };
  }
  const db = getIamDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimeSessionRevocation)
    .where(eq(enterpriseRuntimeSessionRevocation.tenantId, tid))
    .limit(1);
  const prevIds = Array.isArray(row?.revokedSessionIds) ? row!.revokedSessionIds.map(String) : [];
  const nextIds = prevIds.includes(sid) ? prevIds : [...prevIds, sid].slice(-5000);
  const nextVersion = Number(row?.version ?? 0) + 1;
  const now = new Date();
  await db
    .insert(enterpriseRuntimeSessionRevocation)
    .values({
      tenantId: tid,
      version: String(nextVersion),
      revokedSessionIds: nextIds,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: enterpriseRuntimeSessionRevocation.tenantId,
      set: {
        version: String(nextVersion),
        revokedSessionIds: nextIds,
        updatedAt: now,
      },
    });
  return {
    version: nextVersion,
    revokedSessionIds: nextIds,
    updatedAt: now.toISOString(),
  };
}

export async function buildSessionRevocationSnapshotForGateway(): Promise<SessionRevocationSnapshot> {
  const tid = tenant();
  await ensureRevocationRow(tid);
  if (resolveDatabaseConfig().dialect === "mysql") {
    return (await readMysqlSessionRevocation(tid)) ?? {
      version: 0,
      revokedSessionIds: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const db = getIamDb();
  const [row] = await db
    .select()
    .from(enterpriseRuntimeSessionRevocation)
    .where(eq(enterpriseRuntimeSessionRevocation.tenantId, tid))
    .limit(1);
  return {
    version: Number(row?.version ?? 0),
    revokedSessionIds: Array.isArray(row?.revokedSessionIds)
      ? row!.revokedSessionIds.map(String)
      : [],
    updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
  };
}
