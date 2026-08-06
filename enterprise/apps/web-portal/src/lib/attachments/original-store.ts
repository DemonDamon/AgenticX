/**
 * Session-scoped original chat attachments (filesystem blob + PG/MySQL metadata).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { enterpriseChatAttachments as pgTable } from "@agenticx/db-schema";
import { enterpriseChatAttachments as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { ulid } from "ulid";

export const MAX_ORIGINAL_RETAIN_BYTES = Number(
  process.env.ATTACHMENT_MAX_RETAIN_BYTES ?? 50 * 1024 * 1024,
);
/** Orphan attachments (no sessionId) older than this are eligible for purge. */
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

export type AttachmentRecord = {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  kind: string;
  storageDriver: "fs" | "s3";
  storageKey: string;
  checksum: string;
  createdAt: string;
  expiresAt: string | null;
};

export type OriginalStore = {
  put(input: {
    tenantId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    kind: string;
    buffer: Buffer;
  }): Promise<AttachmentRecord>;
  getMeta(tenantId: string, userId: string, id: string): Promise<AttachmentRecord | null>;
  openStream(record: AttachmentRecord): Promise<Readable>;
  bindSession(tenantId: string, ids: string[], sessionId: string): Promise<void>;
  deleteBySession(tenantId: string, sessionId: string): Promise<void>;
  purgeExpiredOrphans(): Promise<number>;
};

function blobRoot(): string {
  const configured = process.env.ATTACHMENT_BLOB_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "../../.runtime/attachments");
}

function resolveSafeBlobPath(storageKey: string): string {
  const root = blobRoot();
  const resolved = path.resolve(root, storageKey);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("invalid storage key: path escape");
  }
  return resolved;
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function yyyymm(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function mapRow(row: {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number | bigint;
  kind: string;
  storageDriver: string;
  storageKey: string;
  checksum: string;
  createdAt: Date | string;
  expiresAt: Date | string | null;
}): AttachmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId ?? null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize) || 0,
    kind: row.kind,
    storageDriver: row.storageDriver === "s3" ? "s3" : "fs",
    storageKey: row.storageKey,
    checksum: row.checksum,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    expiresAt: row.expiresAt
      ? row.expiresAt instanceof Date
        ? row.expiresAt.toISOString()
        : String(row.expiresAt)
      : null,
  };
}

async function writeFsBlob(storageKey: string, buffer: Buffer): Promise<void> {
  const abs = resolveSafeBlobPath(storageKey);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, buffer);
  await rename(tmp, abs);
}

async function removeFsBlob(storageKey: string): Promise<void> {
  try {
    await rm(resolveSafeBlobPath(storageKey), { force: true });
  } catch {
    // best-effort
  }
}

type MemoryRow = AttachmentRecord & { buffer: Buffer };

function createMemoryStore(): OriginalStore {
  const byId = new Map<string, MemoryRow>();
  return {
    async put(input) {
      if (input.buffer.byteLength > MAX_ORIGINAL_RETAIN_BYTES) {
        throw new Error("file exceeds original retain limit");
      }
      const id = ulid();
      const storageKey = `${input.tenantId}/${yyyymm()}/${id}`;
      const row: MemoryRow = {
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: null,
        fileName: input.fileName,
        mimeType: input.mimeType,
        byteSize: input.buffer.byteLength,
        kind: input.kind,
        storageDriver: "fs",
        storageKey,
        checksum: sha256Hex(input.buffer),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ORPHAN_TTL_MS).toISOString(),
        buffer: Buffer.from(input.buffer),
      };
      byId.set(id, row);
      return { ...row };
    },
    async getMeta(tenantId, userId, id) {
      const row = byId.get(id);
      if (!row || row.tenantId !== tenantId || row.userId !== userId) return null;
      const { buffer: _b, ...meta } = row;
      return meta;
    },
    async openStream(record) {
      const row = byId.get(record.id);
      if (!row) throw new Error("attachment blob missing");
      const { Readable } = await import("node:stream");
      return Readable.from(row.buffer);
    },
    async bindSession(tenantId, ids, sessionId) {
      for (const id of ids) {
        const row = byId.get(id);
        if (row && row.tenantId === tenantId) {
          row.sessionId = sessionId;
          row.expiresAt = null;
        }
      }
    },
    async deleteBySession(tenantId, sessionId) {
      for (const [id, row] of byId) {
        if (row.tenantId === tenantId && row.sessionId === sessionId) {
          byId.delete(id);
        }
      }
    },
    async purgeExpiredOrphans() {
      const now = Date.now();
      let n = 0;
      for (const [id, row] of byId) {
        if (row.sessionId) continue;
        if (row.expiresAt && Date.parse(row.expiresAt) < now) {
          byId.delete(id);
          n += 1;
        }
      }
      return n;
    },
  };
}

function createSqlStore(): OriginalStore {
  return {
    async put(input) {
      if (MAX_ORIGINAL_RETAIN_BYTES <= 0 || input.buffer.byteLength > MAX_ORIGINAL_RETAIN_BYTES) {
        throw new Error("file exceeds original retain limit");
      }
      const id = ulid();
      const storageKey = `${input.tenantId}/${yyyymm()}/${id}`;
      const checksum = sha256Hex(input.buffer);
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + ORPHAN_TTL_MS);
      await writeFsBlob(storageKey, input.buffer);

      const values = {
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: null as string | null,
        fileName: input.fileName,
        mimeType: input.mimeType,
        byteSize: input.buffer.byteLength,
        kind: input.kind,
        storageDriver: "fs" as const,
        storageKey,
        checksum,
        createdAt,
        expiresAt,
      };

      const config = resolveDatabaseConfig();
      try {
        if (config.dialect === "mysql") {
          const { raw: db } = await createMysqlDb(config);
          await db.insert(mysqlTable).values(values);
        } else {
          const db = getIamDb();
          await db.insert(pgTable).values(values);
        }
      } catch (error) {
        await removeFsBlob(storageKey);
        throw error;
      }

      return mapRow({ ...values, sessionId: null });
    },

    async getMeta(tenantId, userId, id) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.id, id),
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
            ),
          )
          .limit(1);
        return rows[0] ? mapRow(rows[0]) : null;
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(and(eq(pgTable.id, id), eq(pgTable.tenantId, tenantId), eq(pgTable.userId, userId)))
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async openStream(record) {
      if (record.storageDriver !== "fs") {
        throw new Error(`unsupported storage driver: ${record.storageDriver}`);
      }
      return createReadStream(resolveSafeBlobPath(record.storageKey));
    },

    async bindSession(tenantId, ids, sessionId) {
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) return;
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        await db
          .update(mysqlTable)
          .set({ sessionId, expiresAt: null })
          .where(and(eq(mysqlTable.tenantId, tenantId), inArray(mysqlTable.id, unique)));
        return;
      }
      const db = getIamDb();
      await db
        .update(pgTable)
        .set({ sessionId, expiresAt: null })
        .where(and(eq(pgTable.tenantId, tenantId), inArray(pgTable.id, unique)));
    },

    async deleteBySession(tenantId, sessionId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(and(eq(mysqlTable.tenantId, tenantId), eq(mysqlTable.sessionId, sessionId)));
        for (const row of rows) {
          if (row.storageDriver === "fs") await removeFsBlob(row.storageKey);
        }
        await db
          .delete(mysqlTable)
          .where(and(eq(mysqlTable.tenantId, tenantId), eq(mysqlTable.sessionId, sessionId)));
        return;
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(and(eq(pgTable.tenantId, tenantId), eq(pgTable.sessionId, sessionId)));
      for (const row of rows) {
        if (row.storageDriver === "fs") await removeFsBlob(row.storageKey);
      }
      await db
        .delete(pgTable)
        .where(and(eq(pgTable.tenantId, tenantId), eq(pgTable.sessionId, sessionId)));
    },

    async purgeExpiredOrphans() {
      const cutoff = new Date(Date.now());
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(and(isNull(mysqlTable.sessionId), lt(mysqlTable.expiresAt, cutoff)));
        for (const row of rows) {
          if (row.storageDriver === "fs") await removeFsBlob(row.storageKey);
          await db.delete(mysqlTable).where(eq(mysqlTable.id, row.id));
        }
        return rows.length;
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(and(isNull(pgTable.sessionId), lt(pgTable.expiresAt, cutoff)));
      for (const row of rows) {
        if (row.storageDriver === "fs") await removeFsBlob(row.storageKey);
        await db.delete(pgTable).where(eq(pgTable.id, row.id));
      }
      return rows.length;
    },
  };
}

export function createOriginalStore(): OriginalStore {
  if (!process.env.DATABASE_URL?.trim()) return createMemoryStore();
  try {
    resolveDatabaseConfig();
    return createSqlStore();
  } catch {
    return createMemoryStore();
  }
}

export const defaultOriginalStore = createOriginalStore();

/** Test helper — isolated in-memory bucket (safe for parallel tests). */
export function createMemoryOriginalStore(): OriginalStore {
  return createMemoryStore();
}

/** Exported for unit tests of path safety. */
export function __resolveSafeBlobPathForTests(storageKey: string): string {
  return resolveSafeBlobPath(storageKey);
}
