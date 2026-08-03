/**
 * Session-scoped deep-research artifacts (PG / MySQL / in-memory fallback).
 */

import { enterpriseChatArtifacts as pgTable } from "@agenticx/db-schema";
import { enterpriseChatArtifacts as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

export const MAX_ARTIFACT_BYTES = 512 * 1024;
export const MAX_ARTIFACTS_PER_RUN = 40;

export type ArtifactRecord = {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  path: string;
  title: string;
  kind: "memo" | "report" | "other";
  mimeType: string;
  content: string;
  byteSize: number;
  createdAt: string;
};

export type ArtifactWriteInput = {
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  path: string;
  title: string;
  kind?: "memo" | "report" | "other";
  mimeType?: string;
  content: string;
};

export type ArtifactStore = {
  write(input: ArtifactWriteInput): Promise<ArtifactRecord>;
  listBySession(tenantId: string, userId: string, sessionId: string): Promise<ArtifactRecord[]>;
  /** Artifacts for a single deep-research run (tenant + user scoped). */
  listByRun(tenantId: string, userId: string, runId: string): Promise<ArtifactRecord[]>;
  get(tenantId: string, userId: string, id: string): Promise<ArtifactRecord | null>;
};

type MemoryRow = ArtifactRecord;

function memoryKey(sessionId: string, path: string): string {
  return `${sessionId}::${path}`;
}

function truncateContent(content: string): { content: string; byteSize: number } {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(content);
  if (bytes.length <= MAX_ARTIFACT_BYTES) {
    return { content, byteSize: bytes.length };
  }
  let truncated = content.slice(0, Math.floor(content.length * 0.9));
  while (encoder.encode(truncated).length > MAX_ARTIFACT_BYTES && truncated.length > 0) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.9));
  }
  truncated = `${truncated}\n\n…(truncated)`;
  bytes = encoder.encode(truncated);
  return { content: truncated, byteSize: bytes.length };
}

function createMemoryStore(): ArtifactStore {
  const bucket = new Map<string, MemoryRow>();
  return {
    async write(input) {
      const { content, byteSize } = truncateContent(input.content);
      const key = memoryKey(input.sessionId, input.path);
      const existing = bucket.get(key);
      const row: MemoryRow = {
        id: existing?.id ?? ulid(),
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        runId: input.runId,
        path: input.path,
        title: input.title,
        kind: input.kind ?? "other",
        mimeType: input.mimeType ?? "text/markdown",
        content,
        byteSize,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      bucket.set(key, row);
      return row;
    },
    async listBySession(tenantId, userId, sessionId) {
      return [...bucket.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId && row.userId === userId && row.sessionId === sessionId,
        )
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async listByRun(tenantId, userId, runId) {
      return [...bucket.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId && row.userId === userId && row.runId === runId,
        )
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async get(tenantId, userId, id) {
      for (const row of bucket.values()) {
        if (row.id === id && row.tenantId === tenantId && row.userId === userId) return row;
      }
      return null;
    },
  };
}

function mapRow(row: {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  path: string;
  title: string;
  kind: string;
  mimeType: string;
  content: string;
  byteSize: number;
  createdAt: Date | string;
}): ArtifactRecord {
  const kind =
    row.kind === "memo" || row.kind === "report" || row.kind === "other" ? row.kind : "other";
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    runId: row.runId,
    path: row.path,
    title: row.title,
    kind,
    mimeType: row.mimeType,
    content: row.content,
    byteSize: Number(row.byteSize) || 0,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function createSqlStore(): ArtifactStore {
  return {
    async write(input) {
      const { content, byteSize } = truncateContent(input.content);
      const id = ulid();
      const kind = input.kind ?? "other";
      const mimeType = input.mimeType ?? "text/markdown";
      const createdAt = new Date();
      const config = resolveDatabaseConfig();

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        await db
          .insert(mysqlTable)
          .values({
            id,
            tenantId: input.tenantId,
            userId: input.userId,
            sessionId: input.sessionId,
            runId: input.runId,
            path: input.path,
            title: input.title,
            kind,
            mimeType,
            content,
            byteSize,
            createdAt,
          })
          .onDuplicateKeyUpdate({
            set: {
              runId: input.runId,
              title: input.title,
              kind,
              mimeType,
              content,
              byteSize,
            },
          });
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(and(eq(mysqlTable.sessionId, input.sessionId), eq(mysqlTable.path, input.path)))
          .limit(1);
        return mapRow(rows[0]!);
      }

      const db = getIamDb();
      await db
        .insert(pgTable)
        .values({
          id,
          tenantId: input.tenantId,
          userId: input.userId,
          sessionId: input.sessionId,
          runId: input.runId,
          path: input.path,
          title: input.title,
          kind,
          mimeType,
          content,
          byteSize,
          createdAt,
        })
        .onConflictDoUpdate({
          target: [pgTable.sessionId, pgTable.path],
          set: {
            runId: input.runId,
            title: input.title,
            kind,
            mimeType,
            content,
            byteSize,
          },
        });
      const rows = await db
        .select()
        .from(pgTable)
        .where(and(eq(pgTable.sessionId, input.sessionId), eq(pgTable.path, input.path)))
        .limit(1);
      return mapRow(rows[0]!);
    },

    async listBySession(tenantId, userId, sessionId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
              eq(mysqlTable.sessionId, sessionId),
            ),
          );
        return rows.map(mapRow).sort((a, b) => a.path.localeCompare(b.path));
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
            eq(pgTable.sessionId, sessionId),
          ),
        );
      return rows.map(mapRow).sort((a, b) => a.path.localeCompare(b.path));
    },

    async listByRun(tenantId, userId, runId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
              eq(mysqlTable.runId, runId),
            ),
          );
        return rows.map(mapRow).sort((a, b) => a.path.localeCompare(b.path));
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
            eq(pgTable.runId, runId),
          ),
        );
      return rows.map(mapRow).sort((a, b) => a.path.localeCompare(b.path));
    },

    async get(tenantId, userId, id) {
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
        .where(
          and(eq(pgTable.id, id), eq(pgTable.tenantId, tenantId), eq(pgTable.userId, userId)),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },
  };
}

export function createArtifactStore(): ArtifactStore {
  if (!process.env.DATABASE_URL?.trim()) return createMemoryStore();
  try {
    resolveDatabaseConfig();
    return createSqlStore();
  } catch {
    return createMemoryStore();
  }
}

export const defaultArtifactStore = createArtifactStore();

/** Test helper — isolated in-memory bucket (safe for parallel tests). */
export function createMemoryArtifactStore(): ArtifactStore {
  return createMemoryStore();
}
