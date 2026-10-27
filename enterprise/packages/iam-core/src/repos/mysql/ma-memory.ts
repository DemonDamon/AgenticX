import { auditEvents, maMemories, maMemoryStores, maMemoryVersions, maSessions } from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import type { AuditInsert } from "../audit";
import {
  memoryActorFields,
  memoryPathHash,
  normalizeMemoryPath,
  planMemoryWrite,
  type MemoryActor,
  type MemoryHead,
  type MemoryPathRow,
  type MemoryWriteCurrent,
  type MemoryWriteFailureCode,
  type MemoryWriteOp,
} from "../ma-memory-path";
import { getMysqlRepositoryDb } from "./db";

type MysqlDb = Awaited<ReturnType<typeof getMysqlRepositoryDb>>;
type MemoryRow = typeof maMemories.$inferSelect;
type VersionRow = typeof maMemoryVersions.$inferSelect;

const PATH_CONFLICT_MESSAGE = "path conflicts with an existing memory";

export type MysqlApplyOutcome =
  | { kind: "archived" }
  | {
      kind: "result";
      result:
        | { ok: true; row: MemoryRow | null; version: number }
        | { ok: false; code: MemoryWriteFailureCode; message: string; current: MemoryWriteCurrent | null };
    };

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "ER_DUP_ENTRY" || coded.errno === 1062 || coded.code === "23505") return true;
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_memories_store_path_uq/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

async function writeAudit(tx: MysqlDb, input: AuditInsert): Promise<void> {
  const now = new Date();
  await tx.insert(auditEvents).values({
    id: ulid(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    detail: input.detail ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

function toHead(row: MemoryRow): MemoryHead {
  return {
    id: row.id,
    path: row.path,
    version: Number(row.version),
    contentSha256: row.contentSha256,
    sizeBytes: Number(row.sizeBytes),
    content: row.content,
  };
}

function toPathRow(row: MemoryRow): MemoryPathRow {
  return {
    id: row.id,
    path: row.path,
    version: Number(row.version),
    contentSha256: row.contentSha256,
    sizeBytes: Number(row.sizeBytes),
  };
}

function failure(
  code: MemoryWriteFailureCode,
  message: string,
  current: MemoryWriteCurrent | null,
): MysqlApplyOutcome {
  return { kind: "result", result: { ok: false, code, message, current } };
}

export async function mysqlListStores(tenantId: string, includeArchived: boolean) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maMemoryStores)
    .where(and(eq(maMemoryStores.tenantId, tenantId), includeArchived ? undefined : eq(maMemoryStores.status, "active")))
    .orderBy(desc(maMemoryStores.createdAt));
}

export async function mysqlStoreStats(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({
      storeId: maMemories.storeId,
      n: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${maMemories.sizeBytes}), 0)`,
    })
    .from(maMemories)
    .where(eq(maMemories.tenantId, tenantId))
    .groupBy(maMemories.storeId);
}

export async function mysqlFindStore(tenantId: string, storeId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maMemoryStores)
    .where(and(eq(maMemoryStores.tenantId, tenantId), eq(maMemoryStores.id, storeId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertStore(row: typeof maMemoryStores.$inferInsert, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx.insert(maMemoryStores).values(row);
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlUpdateStore(
  tenantId: string,
  storeId: string,
  patch: Partial<typeof maMemoryStores.$inferInsert>,
  audit: AuditInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx.update(maMemoryStores).set(patch).where(and(eq(maMemoryStores.tenantId, tenantId), eq(maMemoryStores.id, storeId)));
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlDeleteStore(tenantId: string, storeId: string, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await writeAudit(tx as MysqlDb, audit);
    await tx.delete(maMemoryStores).where(and(eq(maMemoryStores.tenantId, tenantId), eq(maMemoryStores.id, storeId)));
  });
}

export async function mysqlCountRunningMounts(tenantId: string, storeId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({ id: maSessions.id })
    .from(maSessions)
    .where(
      and(
        eq(maSessions.tenantId, tenantId),
        inArray(maSessions.status, ["running", "rescheduling"]),
        sql`JSON_CONTAINS(${maSessions.resources}, JSON_OBJECT('memory_store_id', ${storeId}))`,
      ),
    )
    .limit(1);
  return rows.length;
}

export async function mysqlListMemoryRows(tenantId: string, storeId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maMemories)
    .where(and(eq(maMemories.tenantId, tenantId), eq(maMemories.storeId, storeId)))
    .orderBy(asc(maMemories.path));
}

export async function mysqlFindMemory(tenantId: string, storeId: string, memoryId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maMemories)
    .where(and(eq(maMemories.tenantId, tenantId), eq(maMemories.storeId, storeId), eq(maMemories.id, memoryId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMemoryByHash(tenantId: string, storeId: string, pathHash: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maMemories)
    .where(and(eq(maMemories.tenantId, tenantId), eq(maMemories.storeId, storeId), eq(maMemories.pathHash, pathHash)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlValidateStores(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select({ id: maMemoryStores.id, status: maMemoryStores.status, name: maMemoryStores.name })
    .from(maMemoryStores)
    .where(and(eq(maMemoryStores.tenantId, tenantId), inArray(maMemoryStores.id, ids)));
}

export async function mysqlListVersions(
  tenantId: string,
  storeId: string,
  opts: { memoryId?: string; limit: number; before?: { createdAt: Date; id: string } },
) {
  const db = await getMysqlRepositoryDb();
  const filters = [eq(maMemoryVersions.tenantId, tenantId), eq(maMemoryVersions.storeId, storeId)];
  if (opts.memoryId) filters.push(eq(maMemoryVersions.memoryId, opts.memoryId));
  if (opts.before) {
    filters.push(
      sql`(${maMemoryVersions.createdAt} < ${opts.before.createdAt} OR (${maMemoryVersions.createdAt} = ${opts.before.createdAt} AND ${maMemoryVersions.id} < ${opts.before.id}))`,
    );
  }
  return db
    .select()
    .from(maMemoryVersions)
    .where(and(...filters))
    .orderBy(desc(maMemoryVersions.createdAt), desc(maMemoryVersions.id))
    .limit(opts.limit);
}

export async function mysqlFindVersion(tenantId: string, storeId: string, versionId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maMemoryVersions)
    .where(and(eq(maMemoryVersions.tenantId, tenantId), eq(maMemoryVersions.storeId, storeId), eq(maMemoryVersions.id, versionId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlMaxVersion(memoryId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({ v: sql<number>`coalesce(max(${maMemoryVersions.version}), 0)` })
    .from(maMemoryVersions)
    .where(eq(maMemoryVersions.memoryId, memoryId));
  return Number(rows[0]?.v ?? 0) || 0;
}

export async function mysqlRedactVersion(
  tenantId: string,
  storeId: string,
  versionId: string,
  actorUserId: string | null,
  audit: AuditInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(maMemoryVersions)
      .set({
        path: null,
        pathHash: null,
        content: null,
        contentSha256: null,
        sizeBytes: null,
        redacted: true,
        redactedAt: now,
        redactedBy: actorUserId,
      })
      .where(and(eq(maMemoryVersions.tenantId, tenantId), eq(maMemoryVersions.storeId, storeId), eq(maMemoryVersions.id, versionId)));
    await writeAudit(tx as MysqlDb, audit);
  });
}

async function conflictAfterUnique(
  tenantId: string,
  storeId: string,
  op: MemoryWriteOp,
): Promise<MysqlApplyOutcome> {
  const raw = op.op === "create" ? op.path : op.op === "update" ? op.path : undefined;
  if (!raw) return failure("memory_path_conflict", PATH_CONFLICT_MESSAGE, null);
  const path = normalizeMemoryPath(raw);
  const row = await mysqlFindMemoryByHash(tenantId, storeId, memoryPathHash(path));
  return failure(
    "memory_path_conflict",
    PATH_CONFLICT_MESSAGE,
    row
      ? { id: row.id, path: row.path, version: Number(row.version), contentSha256: row.contentSha256 }
      : null,
  );
}

export async function mysqlApplyMemoryWrite(
  tenantId: string,
  storeId: string,
  op: MemoryWriteOp,
  actor: MemoryActor,
): Promise<MysqlApplyOutcome> {
  const db = await getMysqlRepositoryDb();
  try {
    return await db.transaction(async (tx) => {
      const stores = await tx
        .select()
        .from(maMemoryStores)
        .where(and(eq(maMemoryStores.tenantId, tenantId), eq(maMemoryStores.id, storeId)))
        .for("update")
        .limit(1);
      const store = stores[0];
      if (!store) return failure("memory_not_found", "memory store not found", null);
      if (store.status === "archived" && actor.kind === "user") return { kind: "archived" };
      const rows = await tx
        .select()
        .from(maMemories)
        .where(and(eq(maMemories.tenantId, tenantId), eq(maMemories.storeId, storeId)));
      let currentRow: MemoryRow | null = null;
      if (op.op !== "create") {
        const locked = await tx
          .select()
          .from(maMemories)
          .where(and(eq(maMemories.tenantId, tenantId), eq(maMemories.storeId, storeId), eq(maMemories.id, op.memoryId)))
          .for("update")
          .limit(1);
        currentRow = locked[0] ?? null;
      }
      const plan = planMemoryWrite(
        currentRow ? toHead(currentRow) : null,
        op,
        rows.map(toPathRow),
        {
          count: rows.length,
          totalBytes: rows.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0),
        },
      );
      if (plan.kind === "error") return failure(plan.code, plan.message, plan.current);
      if (plan.kind === "noop") {
        if (!currentRow) return failure("memory_not_found", "memory not found", null);
        return { kind: "result", result: { ok: true, row: currentRow, version: Number(currentRow.version) } };
      }
      const actorCols = memoryActorFields(actor);
      const now = new Date();
      if (plan.kind === "insert") {
        const id = ulid();
        await tx.insert(maMemories).values({
          id,
          tenantId,
          storeId,
          path: plan.path,
          pathHash: plan.pathHash,
          content: plan.content,
          contentSha256: plan.contentSha256,
          sizeBytes: plan.sizeBytes,
          version: 1,
          lastActorKind: actorCols.lastActorKind,
          lastActorUserId: actorCols.lastActorUserId,
          lastSessionId: actorCols.lastSessionId,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(maMemoryVersions).values({
          id: ulid(),
          tenantId,
          storeId,
          memoryId: id,
          version: 1,
          operation: "created",
          path: plan.path,
          pathHash: plan.pathHash,
          content: plan.content,
          contentSha256: plan.contentSha256,
          sizeBytes: plan.sizeBytes,
          actorKind: actorCols.actorKind,
          actorUserId: actorCols.actorUserId,
          sourceSessionId: actorCols.sourceSessionId,
          redacted: false,
          createdAt: now,
        });
        const written = await tx.select().from(maMemories).where(eq(maMemories.id, id)).limit(1);
        return { kind: "result", result: { ok: true, row: written[0] ?? null, version: 1 } };
      }
      if (plan.kind === "update") {
        if (!currentRow) return failure("memory_not_found", "memory not found", null);
        await tx
          .update(maMemories)
          .set({
            path: plan.path,
            pathHash: plan.pathHash,
            content: plan.content,
            contentSha256: plan.contentSha256,
            sizeBytes: plan.sizeBytes,
            version: plan.version,
            lastActorKind: actorCols.lastActorKind,
            lastActorUserId: actorCols.lastActorUserId,
            lastSessionId: actorCols.lastSessionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(maMemories.id, currentRow.id),
              eq(maMemories.storeId, storeId),
              eq(maMemories.version, currentRow.version),
            ),
          );
        const written = await tx
          .select()
          .from(maMemories)
          .where(and(eq(maMemories.id, currentRow.id), eq(maMemories.storeId, storeId)))
          .limit(1);
        if (!written[0] || Number(written[0].version) !== plan.version) {
          return failure(
            "memory_version_conflict",
            "memory has been modified",
            written[0]
              ? { id: written[0].id, path: written[0].path, version: Number(written[0].version), contentSha256: written[0].contentSha256 }
              : { id: currentRow.id, path: currentRow.path, version: Number(currentRow.version), contentSha256: currentRow.contentSha256 },
          );
        }
        await tx.insert(maMemoryVersions).values({
          id: ulid(),
          tenantId,
          storeId,
          memoryId: currentRow.id,
          version: plan.version,
          operation: "modified",
          path: plan.path,
          pathHash: plan.pathHash,
          content: plan.content,
          contentSha256: plan.contentSha256,
          sizeBytes: plan.sizeBytes,
          actorKind: actorCols.actorKind,
          actorUserId: actorCols.actorUserId,
          sourceSessionId: actorCols.sourceSessionId,
          redacted: false,
          createdAt: now,
        });
        return { kind: "result", result: { ok: true, row: written[0], version: plan.version } };
      }
      if (plan.kind === "delete") {
        if (!currentRow) return failure("memory_not_found", "memory not found", null);
        await tx.insert(maMemoryVersions).values({
          id: ulid(),
          tenantId,
          storeId,
          memoryId: currentRow.id,
          version: plan.version,
          operation: "deleted",
          path: plan.path,
          pathHash: plan.pathHash,
          content: null,
          contentSha256: null,
          sizeBytes: null,
          actorKind: actorCols.actorKind,
          actorUserId: actorCols.actorUserId,
          sourceSessionId: actorCols.sourceSessionId,
          redacted: false,
          createdAt: now,
        });
        await tx
          .delete(maMemories)
          .where(and(eq(maMemories.id, currentRow.id), eq(maMemories.storeId, storeId), eq(maMemories.version, currentRow.version)));
        const still = await tx.select({ id: maMemories.id }).from(maMemories).where(eq(maMemories.id, currentRow.id)).limit(1);
        if (still[0]) throw new Error("memory delete did not apply");
        return { kind: "result", result: { ok: true, row: null, version: plan.version } };
      }
      const unreachable: never = plan;
      throw new Error(`unexpected memory plan ${(unreachable as { kind?: string }).kind ?? ""}`);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return conflictAfterUnique(tenantId, storeId, op);
  }
}

export type { VersionRow };
