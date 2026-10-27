import {
  maMemories as pgMemories,
  maMemoryStores as pgStores,
  maMemoryVersions as pgVersions,
  maSessions as pgSessions,
} from "@agenticx/db-schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { insertAuditEvent, type AuditInsert } from "./audit";
import {
  MaMemoryValidationError,
  memoryActorFields,
  memoryPathHash,
  normalizeMemoryPath,
  planMemoryWrite,
  type MemoryActor,
  type MemoryHead,
  type MemoryPathRow,
  type MemoryWriteMemory,
  type MemoryWriteOp,
  type MemoryWriteResult,
} from "./ma-memory-path";
import {
  mysqlApplyMemoryWrite,
  mysqlCountRunningMounts,
  mysqlDeleteStore,
  mysqlFindMemory,
  mysqlFindStore,
  mysqlFindVersion,
  mysqlInsertStore,
  mysqlListMemoryRows,
  mysqlListStores,
  mysqlListVersions,
  mysqlMaxVersion,
  mysqlRedactVersion,
  mysqlStoreStats,
  mysqlUpdateStore,
} from "./mysql/ma-memory";

export type MaMemory = MemoryWriteMemory;

export type MaMemoryStoreStatus = "active" | "archived";
export type MaMemoryStore = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  status: MaMemoryStoreStatus;
  memoryCount: number;
  totalBytes: number;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MaMemoryVersion = {
  id: string;
  storeId: string;
  memoryId: string;
  version: number;
  operation: "created" | "modified" | "deleted";
  path: string | null;
  contentSha256: string | null;
  sizeBytes: number | null;
  content?: string | null;
  actorKind: "user" | "agent";
  actorUserId: string | null;
  sourceSessionId: string | null;
  redacted: boolean;
  redactedAt: string | null;
  redactedBy: string | null;
  createdAt: string;
};
export type MemoryListItem =
  | { kind: "memory"; memory: MaMemory }
  | { kind: "memory_prefix"; path: string };

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const DREAM_META_ORIGIN = "agx.origin";
export const DREAM_META_ID = "agx.dream_id";
export const DREAM_META_REVIEW = "agx.review";
export const DREAM_META_INPUT = "agx.dream_input";
export const DREAM_REVIEW_BLOCKING = ["running", "pending", "failed", "cancelled"] as const;
export const DREAM_EXPORT_MAX_ITEMS = 300;
export const DREAM_EXPORT_MAX_BYTES = 204800;
const STORE_NAME_FORBIDDEN = /\p{Cc}|\p{Cf}/u;
const METADATA_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const PATH_CONFLICT_MESSAGE = "path conflicts with an existing memory";

export class MaMemoryStoreNotFoundError extends Error {
  constructor(message = "memory store not found") {
    super(message);
    this.name = "MaMemoryStoreNotFoundError";
  }
}
export class MaMemoryNotFoundError extends Error {
  constructor(message = "memory not found") {
    super(message);
    this.name = "MaMemoryNotFoundError";
  }
}
export class MaMemoryVersionConflictError extends Error {
  current: { id: string; path: string; version: number; contentSha256: string } | null;
  constructor(current: { id: string; path: string; version: number; contentSha256: string } | null) {
    super("memory has been modified");
    this.name = "MaMemoryVersionConflictError";
    this.current = current;
  }
}
export class MaMemoryPathConflictError extends Error {
  conflictingPath: string;
  constructor(conflictingPath: string) {
    super(PATH_CONFLICT_MESSAGE);
    this.name = "MaMemoryPathConflictError";
    this.conflictingPath = conflictingPath;
  }
}
export class MaMemoryStoreArchivedError extends Error {
  constructor(message = "memory store is archived") {
    super(message);
    this.name = "MaMemoryStoreArchivedError";
  }
}
export class MaMemoryStoreNotArchivedError extends Error {
  constructor(message = "archive the memory store before deleting it") {
    super(message);
    this.name = "MaMemoryStoreNotArchivedError";
  }
}
export class MaMemoryStoreInUseError extends Error {
  constructor(message = "memory store is mounted by running sessions") {
    super(message);
    this.name = "MaMemoryStoreInUseError";
  }
}
export class MaMemoryVersionIsHeadError extends Error {
  constructor(message = "cannot redact the current version") {
    super(message);
    this.name = "MaMemoryVersionIsHeadError";
  }
}
export class MaMemoryStoreLimitError extends Error {
  constructor(message = "memory store limit reached (2000 memories / 20 MiB)") {
    super(message);
    this.name = "MaMemoryStoreLimitError";
  }
}

type StoreDbRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  metadata: unknown;
  status: string;
  createdBy: string | null;
  archivedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
type MemoryDbRow = {
  id: string;
  tenantId: string;
  storeId: string;
  path: string;
  content: string;
  contentSha256: string;
  sizeBytes: number;
  version: number;
  lastActorKind: string;
  lastActorUserId: string | null;
  lastSessionId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};
type VersionDbRow = {
  id: string;
  storeId: string;
  memoryId: string;
  version: number;
  operation: string;
  path: string | null;
  content: string | null;
  contentSha256: string | null;
  sizeBytes: number | null;
  actorKind: string;
  actorUserId: string | null;
  sourceSessionId: string | null;
  redacted: boolean | number;
  redactedAt: unknown;
  redactedBy: string | null;
  createdAt: unknown;
};
type StoreInput = {
  name?: string;
  description?: string | null;
  metadata?: Record<string, string>;
};

export function assertCanDeleteMemoryStore(status: MaMemoryStoreStatus, runningSessionCount: number): void {
  if (status !== "archived") throw new MaMemoryStoreNotArchivedError();
  if (runningSessionCount > 0) throw new MaMemoryStoreInUseError();
}

export function planMemoryVersionRedact(
  version: {
    operation: "created" | "modified" | "deleted";
    version: number;
    path: string | null;
    content: string | null;
    redacted: boolean;
  },
  head: { memoryVersion: number | null; maxVersion: number },
): { redacted: true; path: null; content: null } {
  if (version.redacted) return { redacted: true, path: null, content: null };
  const isHead =
    (head.memoryVersion != null && head.memoryVersion === version.version) ||
    (version.operation === "deleted" && version.version === head.maxVersion);
  if (isHead) throw new MaMemoryVersionIsHeadError();
  return { redacted: true, path: null, content: null };
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return value == null ? "" : String(value);
}

function nullableIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  return iso(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function asMetadata(value: unknown): Record<string, string> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function asStoreStatus(value: string): MaMemoryStoreStatus {
  return value === "archived" ? "archived" : "active";
}

function asActorKind(value: string): "user" | "agent" {
  if (value === "user" || value === "agent") return value;
  throw new Error("invalid memory actor");
}

function asOperation(value: string): "created" | "modified" | "deleted" {
  if (value === "created" || value === "modified" || value === "deleted") return value;
  throw new Error("invalid memory operation");
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_memories_store_path_uq/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function validateStoreInput(
  body: { name?: unknown; description?: unknown; metadata?: unknown },
  mode: "create" | "update",
): StoreInput {
  const record = body as Record<string, unknown>;
  const input: StoreInput = {};
  let seen = false;
  if ("name" in record) {
    seen = true;
    if (typeof record.name !== "string") throw new MaMemoryValidationError("name: must be a string");
    const trimmed = record.name.trim();
    if (!trimmed || trimmed.length > 255) throw new MaMemoryValidationError("name: must be 1–255 characters");
    if (STORE_NAME_FORBIDDEN.test(trimmed)) throw new MaMemoryValidationError("name: contains control or format characters");
    input.name = trimmed;
  } else if (mode === "create") {
    throw new MaMemoryValidationError("name: is required");
  }
  if ("description" in record) {
    seen = true;
    if (record.description !== null && typeof record.description !== "string") {
      throw new MaMemoryValidationError("description: must be a string or null");
    }
    if (typeof record.description === "string" && record.description.length > 1024) {
      throw new MaMemoryValidationError("description: must be at most 1024 characters");
    }
    input.description = typeof record.description === "string" ? record.description : null;
  }
  if ("metadata" in record) {
    seen = true;
    if (!isRecord(record.metadata)) throw new MaMemoryValidationError("metadata: must be an object");
    const keys = Object.keys(record.metadata);
    if (keys.length > 16) throw new MaMemoryValidationError("metadata: at most 16 keys");
    const metadata: Record<string, string> = {};
    for (const key of keys) {
      if (!METADATA_KEY_RE.test(key) || key.length > 64) throw new MaMemoryValidationError("metadata: invalid key");
      const item = record.metadata[key];
      if (typeof item !== "string" || item.length > 512) {
        throw new MaMemoryValidationError(`metadata.${key}: value must be a string of at most 512 characters`);
      }
      metadata[key] = item;
    }
    input.metadata = metadata;
  }
  if (mode === "update" && !seen) throw new MaMemoryValidationError("request: nothing to update");
  return input;
}

function mapStore(row: StoreDbRow, memoryCount: number, totalBytes: number): MaMemoryStore {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? null,
    metadata: asMetadata(row.metadata),
    status: asStoreStatus(row.status),
    memoryCount,
    totalBytes,
    createdBy: row.createdBy ?? null,
    archivedAt: nullableIso(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapMemory(row: MemoryDbRow, includeContent: boolean): MaMemory {
  const memory: MaMemory = {
    id: row.id,
    tenantId: row.tenantId,
    storeId: row.storeId,
    path: row.path,
    contentSha256: row.contentSha256,
    sizeBytes: Number(row.sizeBytes) || 0,
    version: Number(row.version) || 0,
    lastActorKind: asActorKind(row.lastActorKind),
    lastActorUserId: row.lastActorUserId ?? null,
    lastSessionId: row.lastSessionId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (includeContent) memory.content = row.content;
  return memory;
}

function mapVersion(row: VersionDbRow, includeContent: boolean): MaMemoryVersion {
  const version: MaMemoryVersion = {
    id: row.id,
    storeId: row.storeId,
    memoryId: row.memoryId,
    version: Number(row.version) || 0,
    operation: asOperation(row.operation),
    path: row.path ?? null,
    contentSha256: row.contentSha256 ?? null,
    sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
    actorKind: asActorKind(row.actorKind),
    actorUserId: row.actorUserId ?? null,
    sourceSessionId: row.sourceSessionId ?? null,
    redacted: Boolean(row.redacted),
    redactedAt: nullableIso(row.redactedAt),
    redactedBy: row.redactedBy ?? null,
    createdAt: iso(row.createdAt),
  };
  if (includeContent) version.content = row.content ?? null;
  return version;
}

function toHead(row: MemoryDbRow): MemoryHead {
  return {
    id: row.id,
    path: row.path,
    version: Number(row.version) || 0,
    contentSha256: row.contentSha256,
    sizeBytes: Number(row.sizeBytes) || 0,
    content: row.content,
  };
}

function toPathRow(row: MemoryDbRow): MemoryPathRow {
  return {
    id: row.id,
    path: row.path,
    version: Number(row.version) || 0,
    contentSha256: row.contentSha256,
    sizeBytes: Number(row.sizeBytes) || 0,
  };
}

async function statsMap(tenantId: string): Promise<Map<string, { count: number; bytes: number }>> {
  if (isMysql()) {
    const rows = await mysqlStoreStats(tenantId);
    return new Map(rows.map((row) => [row.storeId, { count: Number(row.n) || 0, bytes: Number(row.bytes) || 0 }]));
  }
  const rows = await getIamDb()
    .select({
      storeId: pgMemories.storeId,
      n: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${pgMemories.sizeBytes}), 0)`,
    })
    .from(pgMemories)
    .where(eq(pgMemories.tenantId, tenantId))
    .groupBy(pgMemories.storeId);
  return new Map(rows.map((row) => [row.storeId, { count: Number(row.n) || 0, bytes: Number(row.bytes) || 0 }]));
}

async function findStoreRow(tenantId: string, storeId: string): Promise<StoreDbRow | null> {
  if (!ULID_RE.test(storeId)) return null;
  if (isMysql()) return (await mysqlFindStore(tenantId, storeId)) as StoreDbRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgStores)
    .where(and(eq(pgStores.tenantId, tenantId), eq(pgStores.id, storeId)))
    .limit(1);
  return (rows[0] as StoreDbRow | undefined) ?? null;
}

async function requireStore(tenantId: string, storeId: string): Promise<MaMemoryStore> {
  const row = await findStoreRow(tenantId, storeId.trim());
  if (!row) throw new MaMemoryStoreNotFoundError();
  const stats = await statsMap(tenantId);
  const stat = stats.get(row.id);
  return mapStore(row, stat?.count ?? 0, stat?.bytes ?? 0);
}

async function countRunningMounts(tenantId: string, storeId: string): Promise<number> {
  if (isMysql()) return mysqlCountRunningMounts(tenantId, storeId);
  const rows = await getIamDb()
    .select({ id: pgSessions.id })
    .from(pgSessions)
    .where(
      and(
        eq(pgSessions.tenantId, tenantId),
        inArray(pgSessions.status, ["running", "rescheduling"]),
        sql`${pgSessions.resources} @> jsonb_build_array(jsonb_build_object('memory_store_id', CAST(${storeId} AS text)))`,
      ),
    )
    .limit(1);
  return rows.length;
}

function assertListArgs(opts: { pathPrefix?: string; depth?: number; view: "basic" | "full"; limit: number }): void {
  if (opts.view !== "basic" && opts.view !== "full") throw new MaMemoryValidationError("view: must be basic or full");
  const max = opts.view === "full" ? 20 : 200;
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > max) {
    throw new MaMemoryValidationError(
      opts.view === "full" ? "limit: must be at most 20 when view is full" : "limit: must be at most 200",
    );
  }
  const prefix = opts.pathPrefix ?? "/";
  if (!prefix.endsWith("/")) throw new MaMemoryValidationError('path_prefix: must end with "/"');
  if (opts.depth != null && (!Number.isInteger(opts.depth) || opts.depth < 0 || opts.depth > 1024)) {
    throw new MaMemoryValidationError("depth: must be an integer from 0 to 1024");
  }
}

function encodeMemoryCursor(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

function decodeMemoryCursor(cursor: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new MaMemoryValidationError("cursor: is invalid");
  const path = Buffer.from(cursor, "base64url").toString("utf8");
  if (!path.startsWith("/")) throw new MaMemoryValidationError("cursor: is invalid");
  return path;
}

function itemPath(item: MemoryListItem): string {
  return item.kind === "memory" ? item.memory.path : item.path;
}

function foldMemories(
  rows: MaMemory[],
  opts: { pathPrefix?: string; depth?: number; view: "basic" | "full"; limit: number; cursor?: string },
): { items: MemoryListItem[]; nextCursor: string | null } {
  const prefix = opts.pathPrefix ?? "/";
  const folded = new Map<string, MemoryListItem>();
  for (const memory of rows) {
    if (!memory.path.startsWith(prefix)) continue;
    const segments = memory.path.slice(prefix.length).split("/");
    if (opts.depth == null || segments.length <= opts.depth) {
      const visible = opts.view === "full" ? memory : { ...memory, content: undefined };
      if (opts.view !== "full") delete visible.content;
      folded.set(memory.path, { kind: "memory", memory: visible });
    } else {
      const foldedPath = opts.depth === 0 ? prefix : `${prefix}${segments.slice(0, opts.depth).join("/")}/`;
      if (!folded.has(foldedPath)) folded.set(foldedPath, { kind: "memory_prefix", path: foldedPath });
    }
  }
  let items = [...folded.values()].sort((left, right) => itemPath(left).localeCompare(itemPath(right)));
  if (opts.cursor) {
    const cursorPath = decodeMemoryCursor(opts.cursor);
    items = items.filter((item) => itemPath(item) > cursorPath);
  }
  const page = items.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: items.length > page.length && last ? encodeMemoryCursor(itemPath(last)) : null,
  };
}

function encodeVersionCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt, id }), "utf8").toString("base64url");
}

function decodeVersionCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") throw new Error("bad cursor");
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) throw new Error("bad cursor");
    return { createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof MaMemoryValidationError) throw error;
    throw new MaMemoryValidationError("cursor: is invalid");
  }
}

async function listVersionRows(
  tenantId: string,
  storeId: string,
  opts: { memoryId?: string; limit: number; before?: { createdAt: Date; id: string } },
): Promise<VersionDbRow[]> {
  if (isMysql()) return (await mysqlListVersions(tenantId, storeId, opts)) as VersionDbRow[];
  const before = opts.before;
  const cursorSql = before
    ? sql`(${pgVersions.createdAt} < ${before.createdAt} OR (${pgVersions.createdAt} = ${before.createdAt} AND ${pgVersions.id} < ${before.id}))`
    : undefined;
  const rows = await getIamDb()
    .select()
    .from(pgVersions)
    .where(
      and(
        eq(pgVersions.tenantId, tenantId),
        eq(pgVersions.storeId, storeId),
        opts.memoryId ? eq(pgVersions.memoryId, opts.memoryId) : undefined,
        cursorSql,
      ),
    )
    .orderBy(desc(pgVersions.createdAt), desc(pgVersions.id))
    .limit(opts.limit);
  return rows as VersionDbRow[];
}

async function findVersionRow(tenantId: string, storeId: string, versionId: string): Promise<VersionDbRow | null> {
  if (!ULID_RE.test(storeId) || !ULID_RE.test(versionId)) return null;
  if (isMysql()) return (await mysqlFindVersion(tenantId, storeId, versionId)) as VersionDbRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgVersions)
    .where(and(eq(pgVersions.tenantId, tenantId), eq(pgVersions.storeId, storeId), eq(pgVersions.id, versionId)))
    .limit(1);
  return (rows[0] as VersionDbRow | undefined) ?? null;
}

async function findMemoryRow(tenantId: string, storeId: string, memoryId: string): Promise<MemoryDbRow | null> {
  if (!ULID_RE.test(storeId) || !ULID_RE.test(memoryId)) return null;
  if (isMysql()) return (await mysqlFindMemory(tenantId, storeId, memoryId)) as MemoryDbRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgMemories)
    .where(and(eq(pgMemories.tenantId, tenantId), eq(pgMemories.storeId, storeId), eq(pgMemories.id, memoryId)))
    .limit(1);
  return (rows[0] as MemoryDbRow | undefined) ?? null;
}

async function maxVersion(memoryId: string): Promise<number> {
  if (isMysql()) return mysqlMaxVersion(memoryId);
  const rows = await getIamDb()
    .select({ v: sql<number>`coalesce(max(${pgVersions.version}), 0)` })
    .from(pgVersions)
    .where(eq(pgVersions.memoryId, memoryId));
  return Number(rows[0]?.v ?? 0) || 0;
}

async function loadMemoryRows(tenantId: string, storeId: string): Promise<MemoryDbRow[]> {
  if (isMysql()) return (await mysqlListMemoryRows(tenantId, storeId)) as MemoryDbRow[];
  const rows = await getIamDb()
    .select()
    .from(pgMemories)
    .where(and(eq(pgMemories.tenantId, tenantId), eq(pgMemories.storeId, storeId)))
    .orderBy(asc(pgMemories.path));
  return rows as MemoryDbRow[];
}

export async function listMemoryStores(tenantId: string, opts?: { includeArchived?: boolean }): Promise<MaMemoryStore[]> {
  const includeArchived = opts?.includeArchived === true;
  const rows = isMysql()
    ? await mysqlListStores(tenantId, includeArchived)
    : await getIamDb()
        .select()
        .from(pgStores)
        .where(and(eq(pgStores.tenantId, tenantId), includeArchived ? undefined : eq(pgStores.status, "active")))
        .orderBy(desc(pgStores.createdAt));
  const stats = await statsMap(tenantId);
  return (rows as StoreDbRow[]).map((row) => {
    const stat = stats.get(row.id);
    return mapStore(row, stat?.count ?? 0, stat?.bytes ?? 0);
  });
}

export async function getMemoryStore(tenantId: string, storeId: string): Promise<MaMemoryStore> {
  return requireStore(tenantId, storeId);
}

export async function createMemoryStore(
  tenantId: string,
  input: { name?: unknown; description?: unknown; metadata?: unknown },
  actorUserId: string | null,
): Promise<MaMemoryStore> {
  const normalized = validateStoreInput(input, "create");
  if (!normalized.name) throw new MaMemoryValidationError("name: is required");
  const now = new Date();
  const id = ulid();
  const row = {
    id,
    tenantId,
    name: normalized.name,
    description: normalized.description ?? null,
    metadata: normalized.metadata ?? {},
    status: "active" as const,
    createdBy: actorUserId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.memory_store.create",
    targetKind: "ma_memory_store",
    targetId: id,
    detail: { name: row.name },
  };
  if (isMysql()) await mysqlInsertStore(row, audit);
  else {
    await getIamDb().transaction(async (tx) => {
      await tx.insert(pgStores).values(row);
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
    });
  }
  return getMemoryStore(tenantId, id);
}

export async function updateMemoryStore(
  tenantId: string,
  storeId: string,
  patch: { name?: unknown; description?: unknown; metadata?: unknown },
  actorUserId: string | null,
): Promise<MaMemoryStore> {
  const existing = await getMemoryStore(tenantId, storeId);
  if (existing.status === "archived") throw new MaMemoryStoreArchivedError();
  const normalized = validateStoreInput(patch, "update");
  const now = new Date();
  const set: { name?: string; description?: string | null; metadata?: Record<string, string>; updatedAt: Date } = {
    updatedAt: now,
  };
  const changed: string[] = [];
  if (normalized.name !== undefined) {
    set.name = normalized.name;
    changed.push("name");
  }
  if (normalized.description !== undefined) {
    set.description = normalized.description;
    changed.push("description");
  }
  if (normalized.metadata !== undefined) {
    set.metadata = normalized.metadata;
    changed.push("metadata");
  }
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.memory_store.update",
    targetKind: "ma_memory_store",
    targetId: existing.id,
    detail: { changed },
  };
  if (isMysql()) await mysqlUpdateStore(tenantId, existing.id, set, audit);
  else {
    await getIamDb().transaction(async (tx) => {
      await tx.update(pgStores).set(set).where(and(eq(pgStores.tenantId, tenantId), eq(pgStores.id, existing.id)));
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
    });
  }
  return getMemoryStore(tenantId, existing.id);
}

export async function archiveMemoryStore(tenantId: string, storeId: string, actorUserId: string | null): Promise<MaMemoryStore> {
  const existing = await getMemoryStore(tenantId, storeId);
  if (existing.status === "archived") return existing;
  const now = new Date();
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.memory_store.archive",
    targetKind: "ma_memory_store",
    targetId: existing.id,
    detail: { name: existing.name },
  };
  const set = { status: "archived" as const, archivedAt: now, updatedAt: now };
  if (isMysql()) await mysqlUpdateStore(tenantId, existing.id, set, audit);
  else {
    await getIamDb().transaction(async (tx) => {
      await tx.update(pgStores).set(set).where(and(eq(pgStores.tenantId, tenantId), eq(pgStores.id, existing.id)));
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
    });
  }
  return getMemoryStore(tenantId, existing.id);
}

export async function deleteMemoryStore(tenantId: string, storeId: string, actorUserId: string | null): Promise<void> {
  const existing = await getMemoryStore(tenantId, storeId);
  const running = await countRunningMounts(tenantId, existing.id);
  assertCanDeleteMemoryStore(existing.status, running);
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.memory_store.delete",
    targetKind: "ma_memory_store",
    targetId: existing.id,
    detail: { name: existing.name },
  };
  if (isMysql()) {
    await mysqlDeleteStore(tenantId, existing.id, audit);
    return;
  }
  await getIamDb().transaction(async (tx) => {
    await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
    await tx.delete(pgStores).where(and(eq(pgStores.tenantId, tenantId), eq(pgStores.id, existing.id)));
  });
}

export async function listMemories(
  tenantId: string,
  storeId: string,
  opts: { pathPrefix?: string; depth?: number; view: "basic" | "full"; limit: number; cursor?: string },
): Promise<{ items: MemoryListItem[]; nextCursor: string | null }> {
  assertListArgs(opts);
  await requireStore(tenantId, storeId);
  const rows = await loadMemoryRows(tenantId, storeId.trim());
  return foldMemories(rows.map((row) => mapMemory(row, true)), opts);
}

export async function getMemory(tenantId: string, storeId: string, memoryId: string): Promise<MaMemory> {
  await requireStore(tenantId, storeId);
  const row = await findMemoryRow(tenantId, storeId.trim(), memoryId.trim());
  if (!row) throw new MaMemoryNotFoundError();
  return mapMemory(row, true);
}

async function pgApplyMemoryWrite(
  tenantId: string,
  storeId: string,
  op: MemoryWriteOp,
  actor: MemoryActor,
): Promise<MemoryWriteResult> {
  const db = getIamDb();
  try {
    return await db.transaction(async (tx) => {
      const stores = await tx
        .select()
        .from(pgStores)
        .where(and(eq(pgStores.tenantId, tenantId), eq(pgStores.id, storeId)))
        .for("update")
        .limit(1);
      const store = stores[0];
      if (!store) return { ok: false, code: "memory_not_found", message: "memory store not found", current: null };
      if (store.status === "archived" && actor.kind === "user") throw new MaMemoryStoreArchivedError();
      const rows = (await tx
        .select()
        .from(pgMemories)
        .where(and(eq(pgMemories.tenantId, tenantId), eq(pgMemories.storeId, storeId)))) as MemoryDbRow[];
      let currentRow: MemoryDbRow | null = null;
      if (op.op !== "create") {
        const locked = await tx
          .select()
          .from(pgMemories)
          .where(and(eq(pgMemories.tenantId, tenantId), eq(pgMemories.storeId, storeId), eq(pgMemories.id, op.memoryId)))
          .for("update")
          .limit(1);
        currentRow = (locked[0] as MemoryDbRow | undefined) ?? null;
      }
      const plan = planMemoryWrite(
        currentRow ? toHead(currentRow) : null,
        op,
        rows.map(toPathRow),
        { count: rows.length, totalBytes: rows.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0) },
      );
      if (plan.kind === "error") return { ok: false, code: plan.code, message: plan.message, current: plan.current };
      if (plan.kind === "noop") {
        if (!currentRow) return { ok: false, code: "memory_not_found", message: "memory not found", current: null };
        return { ok: true, memory: mapMemory(currentRow, true), version: Number(currentRow.version) || 0 };
      }
      const actorCols = memoryActorFields(actor);
      const now = new Date();
      if (plan.kind === "insert") {
        const id = ulid();
        await tx.insert(pgMemories).values({
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
        await tx.insert(pgVersions).values({
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
        const written = await tx.select().from(pgMemories).where(eq(pgMemories.id, id)).limit(1);
        const row = written[0] as MemoryDbRow | undefined;
        return { ok: true, memory: row ? mapMemory(row, true) : null, version: 1 };
      }
      if (plan.kind === "update") {
        if (!currentRow) return { ok: false, code: "memory_not_found", message: "memory not found", current: null };
        const updated = await tx
          .update(pgMemories)
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
          .where(and(eq(pgMemories.id, currentRow.id), eq(pgMemories.storeId, storeId), eq(pgMemories.version, currentRow.version)))
          .returning({ id: pgMemories.id });
        if (updated.length === 0) {
          const latest = await tx
            .select()
            .from(pgMemories)
            .where(and(eq(pgMemories.id, currentRow.id), eq(pgMemories.storeId, storeId)))
            .limit(1);
          const row = latest[0] as MemoryDbRow | undefined;
          return {
            ok: false,
            code: "memory_version_conflict",
            message: "memory has been modified",
            current: row
              ? { id: row.id, path: row.path, version: Number(row.version) || 0, contentSha256: row.contentSha256 }
              : { id: currentRow.id, path: currentRow.path, version: Number(currentRow.version) || 0, contentSha256: currentRow.contentSha256 },
          };
        }
        await tx.insert(pgVersions).values({
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
        const written = await tx.select().from(pgMemories).where(eq(pgMemories.id, currentRow.id)).limit(1);
        const row = written[0] as MemoryDbRow | undefined;
        return { ok: true, memory: row ? mapMemory(row, true) : null, version: plan.version };
      }
      if (plan.kind === "delete") {
        if (!currentRow) return { ok: false, code: "memory_not_found", message: "memory not found", current: null };
        await tx.insert(pgVersions).values({
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
          .delete(pgMemories)
          .where(and(eq(pgMemories.id, currentRow.id), eq(pgMemories.storeId, storeId), eq(pgMemories.version, currentRow.version)));
        return { ok: true, memory: null, version: plan.version };
      }
      const unreachable: never = plan;
      throw new Error(`unexpected memory plan ${(unreachable as { kind?: string }).kind ?? ""}`);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raw = op.op === "create" ? op.path : op.op === "update" ? op.path : undefined;
    if (!raw) return { ok: false, code: "memory_path_conflict", message: PATH_CONFLICT_MESSAGE, current: null };
    const path = normalizeMemoryPath(raw);
    const row = (await getIamDb()
      .select()
      .from(pgMemories)
      .where(and(eq(pgMemories.tenantId, tenantId), eq(pgMemories.storeId, storeId), eq(pgMemories.pathHash, memoryPathHash(path))))
      .limit(1))[0] as MemoryDbRow | undefined;
    return {
      ok: false,
      code: "memory_path_conflict",
      message: PATH_CONFLICT_MESSAGE,
      current: row ? { id: row.id, path: row.path, version: Number(row.version) || 0, contentSha256: row.contentSha256 } : null,
    };
  }
}

export async function applyMemoryWrite(
  tenantId: string,
  storeId: string,
  op: MemoryWriteOp,
  actor: MemoryActor,
): Promise<MemoryWriteResult> {
  if (!ULID_RE.test(storeId)) {
    return { ok: false, code: "memory_not_found", message: "memory store not found", current: null };
  }
  try {
    if (isMysql()) {
      const outcome = await mysqlApplyMemoryWrite(tenantId, storeId, op, actor);
      if (outcome.kind === "archived") throw new MaMemoryStoreArchivedError();
      if (!outcome.result.ok) return outcome.result;
      return {
        ok: true,
        memory: outcome.result.row ? mapMemory(outcome.result.row as MemoryDbRow, true) : null,
        version: outcome.result.version,
      };
    }
    return await pgApplyMemoryWrite(tenantId, storeId, op, actor);
  } catch (error) {
    if (error instanceof MaMemoryValidationError || (error instanceof Error && error.name === "MaMemoryValidationError")) {
      return { ok: false, code: "invalid_request", message: error instanceof Error ? error.message : "invalid request", current: null };
    }
    throw error;
  }
}

export async function listMemoryVersions(
  tenantId: string,
  storeId: string,
  opts: { memoryId?: string; limit: number; cursor?: string },
): Promise<{ items: MaMemoryVersion[]; nextCursor: string | null }> {
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200) {
    throw new MaMemoryValidationError("limit: must be an integer from 1 to 200");
  }
  if (opts.memoryId && !ULID_RE.test(opts.memoryId)) throw new MaMemoryNotFoundError();
  await requireStore(tenantId, storeId);
  const before = opts.cursor ? decodeVersionCursor(opts.cursor) : undefined;
  const rows = await listVersionRows(tenantId, storeId.trim(), {
    memoryId: opts.memoryId,
    limit: opts.limit + 1,
    before,
  });
  const page = rows.slice(0, opts.limit).map((row) => mapVersion(row, false));
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: rows.length > opts.limit && last ? encodeVersionCursor(last.createdAt, last.id) : null,
  };
}

export async function getMemoryVersion(tenantId: string, storeId: string, versionId: string): Promise<MaMemoryVersion> {
  await requireStore(tenantId, storeId);
  const row = await findVersionRow(tenantId, storeId.trim(), versionId.trim());
  if (!row) throw new MaMemoryNotFoundError();
  return mapVersion(row, true);
}

export async function redactMemoryVersion(
  tenantId: string,
  storeId: string,
  versionId: string,
  actorUserId: string | null,
): Promise<MaMemoryVersion> {
  const existing = await getMemoryVersion(tenantId, storeId, versionId);
  if (existing.redacted) return existing;
  const memory = await findMemoryRow(tenantId, storeId.trim(), existing.memoryId);
  const max = await maxVersion(existing.memoryId);
  planMemoryVersionRedact(
    {
      operation: existing.operation,
      version: existing.version,
      path: existing.path,
      content: existing.content ?? null,
      redacted: existing.redacted,
    },
    { memoryVersion: memory ? Number(memory.version) || 0 : null, maxVersion: max },
  );
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.memory_version.redact",
    targetKind: "ma_memory_version",
    targetId: existing.id,
    detail: { memory_id: existing.memoryId, version: existing.version },
  };
  if (isMysql()) {
    await mysqlRedactVersion(tenantId, storeId.trim(), existing.id, actorUserId, audit);
  } else {
    const now = new Date();
    await getIamDb().transaction(async (tx) => {
      await tx
        .update(pgVersions)
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
        .where(and(eq(pgVersions.tenantId, tenantId), eq(pgVersions.storeId, storeId.trim()), eq(pgVersions.id, existing.id)));
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
    });
  }
  return getMemoryVersion(tenantId, storeId, existing.id);
}

export async function snapshotMemoryStore(
  tenantId: string,
  storeId: string,
): Promise<{ store: MaMemoryStore; memories: MaMemory[] }> {
  const store = await getMemoryStore(tenantId, storeId);
  const rows = await loadMemoryRows(tenantId, store.id);
  return { store, memories: rows.map((row) => mapMemory(row, true)) };
}

export function dreamOutputMetadata(dreamId: string, inputStoreId: string): Record<string, string> {
  return {
    [DREAM_META_ORIGIN]: "dream",
    [DREAM_META_ID]: dreamId,
    [DREAM_META_REVIEW]: "running",
    [DREAM_META_INPUT]: inputStoreId,
  };
}

export function memoryStoreValidationStatus(
  status: string,
  metadata: unknown,
): "active" | "archived" | "pending_review" {
  if (status === "archived") return "archived";
  const review = asMetadata(metadata)[DREAM_META_REVIEW] ?? "";
  if ((DREAM_REVIEW_BLOCKING as readonly string[]).includes(review)) return "pending_review";
  return "active";
}

export function planDreamReviewDecision(
  metadata: Record<string, string>,
  decision: "approve" | "discard",
): { review: "approved" | "discarded"; archive: boolean } {
  if (metadata[DREAM_META_ORIGIN] !== "dream" || metadata[DREAM_META_REVIEW] !== "pending") {
    throw new MaMemoryValidationError("memory store is not awaiting review");
  }
  switch (decision) {
    case "approve":
      return { review: "approved", archive: false };
    case "discard":
      return { review: "discarded", archive: true };
    default: {
      const unreachable: never = decision;
      throw new MaMemoryValidationError(String(unreachable));
    }
  }
}

async function loadValidationRows(
  tenantId: string,
  lookupIds: string[],
): Promise<Array<{ id: string; status: string; name: string; metadata: unknown }>> {
  if (lookupIds.length === 0) return [];
  if (isMysql()) {
    const loaded = await Promise.all(lookupIds.map((id) => mysqlFindStore(tenantId, id)));
    return loaded.flatMap((row) => (row ? [{ id: row.id, status: row.status, name: row.name, metadata: row.metadata }] : []));
  }
  return getIamDb()
    .select({ id: pgStores.id, status: pgStores.status, name: pgStores.name, metadata: pgStores.metadata })
    .from(pgStores)
    .where(and(eq(pgStores.tenantId, tenantId), inArray(pgStores.id, lookupIds)));
}

export async function validateMemoryStoreIds(
  tenantId: string,
  ids: string[],
): Promise<Array<{ id: string; status: "active" | "archived" | "missing" | "pending_review"; name: string | null }>> {
  const lookupIds = ids.filter((id) => ULID_RE.test(id));
  const rows = await loadValidationRows(tenantId, lookupIds);
  const found = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = found.get(id);
    if (!row) return { id, status: "missing", name: null };
    return { id, status: memoryStoreValidationStatus(row.status, row.metadata), name: row.name };
  });
}

export async function exportMemoryStoreForDream(
  tenantId: string,
  storeId: string,
): Promise<{ store: MaMemoryStore; memories: { path: string; content: string }[] }> {
  const snapshot = await snapshotMemoryStore(tenantId, storeId);
  const memories = snapshot.memories.map((memory) => ({ path: memory.path, content: memory.content ?? "" }));
  const bytes = memories.reduce((sum, memory) => sum + Buffer.byteLength(memory.content, "utf8"), 0);
  if (memories.length > DREAM_EXPORT_MAX_ITEMS || bytes > DREAM_EXPORT_MAX_BYTES) {
    throw new MaMemoryStoreLimitError();
  }
  return { store: snapshot.store, memories };
}

export async function createDreamOutputStore(
  tenantId: string,
  input: {
    inputStoreId: string;
    name: string;
    description?: string | null;
    dreamId: string;
    createdBy: string | null;
    metadata?: Record<string, string>;
  },
): Promise<MaMemoryStore> {
  await getMemoryStore(tenantId, input.inputStoreId);
  return createMemoryStore(
    tenantId,
    {
      name: input.name,
      description: input.description ?? null,
      metadata: input.metadata ?? dreamOutputMetadata(input.dreamId, input.inputStoreId),
    },
    input.createdBy,
  );
}

export async function finishDreamOutputStore(
  tenantId: string,
  storeId: string,
  input: {
    dreamId: string;
    outcome: "completed" | "failed" | "cancelled";
    memories: { path: string; content: string }[];
    actorUserId: string | null;
  },
): Promise<MaMemoryStore> {
  const store = await getMemoryStore(tenantId, storeId);
  if (store.metadata[DREAM_META_ID] !== input.dreamId || store.metadata[DREAM_META_REVIEW] !== "running") {
    throw new MaMemoryStoreNotFoundError();
  }
  switch (input.outcome) {
    case "completed": {
      for (const memory of input.memories) {
        const result = await applyMemoryWrite(
          tenantId,
          store.id,
          { op: "create", path: memory.path, content: memory.content },
          { kind: "user", userId: input.actorUserId },
        );
        if (!result.ok) {
          throw new MaMemoryValidationError(`dream import failed at ${memory.path}: ${result.code}`);
        }
      }
      return updateMemoryStore(
        tenantId,
        store.id,
        { metadata: { ...store.metadata, [DREAM_META_REVIEW]: "pending" } },
        input.actorUserId,
      );
    }
    case "failed":
    case "cancelled": {
      await updateMemoryStore(
        tenantId,
        store.id,
        { metadata: { ...store.metadata, [DREAM_META_REVIEW]: input.outcome } },
        input.actorUserId,
      );
      return archiveMemoryStore(tenantId, store.id, input.actorUserId);
    }
    default: {
      const unreachable: never = input.outcome;
      throw new MaMemoryValidationError(String(unreachable));
    }
  }
}

export async function setDreamReviewDecision(
  tenantId: string,
  storeId: string,
  decision: "approve" | "discard",
  actorUserId: string | null,
): Promise<MaMemoryStore> {
  const store = await getMemoryStore(tenantId, storeId);
  const plan = planDreamReviewDecision(store.metadata, decision);
  const updated = await updateMemoryStore(
    tenantId,
    store.id,
    { metadata: { ...store.metadata, [DREAM_META_REVIEW]: plan.review } },
    actorUserId,
  );
  if (!plan.archive) return updated;
  return archiveMemoryStore(tenantId, store.id, actorUserId);
}
