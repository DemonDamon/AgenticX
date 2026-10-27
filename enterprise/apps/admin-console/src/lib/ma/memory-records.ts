import { NextResponse } from "next/server";
import { getMaSession, type MaMemory, type MaMemoryStore, type MaMemoryVersion, type MemoryWriteOp, type MemoryWriteResult } from "@agenticx/iam-core";

import { maError } from "./errors";
import { MaRequestError, ULID_RE } from "./http";
import { noStore } from "./vault-input";

export type MemoryStoreRecord = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  status: "active" | "archived";
  memory_count: number;
  total_bytes: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type MemoryRecord = {
  id: string;
  memory_store_id: string;
  path: string;
  content_sha256: string;
  size_bytes: number;
  version: number;
  last_actor:
    | { type: "user"; user_id: string | null }
    | { type: "agent"; user_id: string | null; session_id: string };
  created_at: string;
  updated_at: string;
  content?: string;
};

export type MemoryVersionRecord = {
  id: string;
  memory_store_id: string;
  memory_id: string;
  version: number;
  operation: "created" | "modified" | "deleted";
  path: string | null;
  content_sha256: string | null;
  size_bytes: number | null;
  actor:
    | { type: "user_actor"; user_id: string | null }
    | { type: "session_actor"; user_id: string | null; session_id: string };
  redacted: boolean;
  redacted_at: string | null;
  redacted_by: string | null;
  created_at: string;
  content?: string | null;
};

export type ParsedMemoryOp = { ok: true; op: MemoryWriteOp } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownField(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const unknown = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .sort();
  return unknown[0] ? `unknown field: ${unknown[0]}` : null;
}

function readExpectedVersion(value: unknown): number | string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return "expected_version: must be a positive integer";
  }
  return value;
}

export function toMemoryStoreRecord(store: MaMemoryStore): MemoryStoreRecord {
  return {
    id: store.id,
    tenant_id: store.tenantId,
    name: store.name,
    description: store.description,
    metadata: store.metadata,
    status: store.status,
    memory_count: store.memoryCount,
    total_bytes: store.totalBytes,
    created_at: store.createdAt,
    updated_at: store.updatedAt,
    archived_at: store.archivedAt,
  };
}

export function toMemoryRecord(memory: MaMemory, includeContent: boolean): MemoryRecord {
  let lastActor: MemoryRecord["last_actor"];
  switch (memory.lastActorKind) {
    case "user":
      lastActor = { type: "user", user_id: memory.lastActorUserId };
      break;
    case "agent":
      lastActor = { type: "agent", user_id: memory.lastActorUserId, session_id: memory.lastSessionId ?? "" };
      break;
    default: {
      const unreachable: never = memory.lastActorKind;
      throw new Error(`unexpected actor ${String(unreachable)}`);
    }
  }
  const record: MemoryRecord = {
    id: memory.id,
    memory_store_id: memory.storeId,
    path: memory.path,
    content_sha256: memory.contentSha256,
    size_bytes: memory.sizeBytes,
    version: memory.version,
    last_actor: lastActor,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
  };
  if (includeContent) record.content = memory.content ?? "";
  return record;
}

export function toMemoryVersionRecord(version: MaMemoryVersion, includeContent: boolean): MemoryVersionRecord {
  let actor: MemoryVersionRecord["actor"];
  switch (version.actorKind) {
    case "user":
      actor = { type: "user_actor", user_id: version.actorUserId };
      break;
    case "agent":
      actor = { type: "session_actor", user_id: version.actorUserId, session_id: version.sourceSessionId ?? "" };
      break;
    default: {
      const unreachable: never = version.actorKind;
      throw new Error(`unexpected actor ${String(unreachable)}`);
    }
  }
  const record: MemoryVersionRecord = {
    id: version.id,
    memory_store_id: version.storeId,
    memory_id: version.memoryId,
    version: version.version,
    operation: version.operation,
    path: version.path,
    content_sha256: version.contentSha256,
    size_bytes: version.sizeBytes,
    actor,
    redacted: version.redacted,
    redacted_at: version.redactedAt,
    redacted_by: version.redactedBy,
    created_at: version.createdAt,
  };
  if (includeContent) record.content = version.content ?? null;
  return record;
}

export function currentDetails(current: { id: string; path: string; version: number; contentSha256: string } | null) {
  if (!current) return null;
  return { id: current.id, path: current.path, version: current.version, content_sha256: current.contentSha256 };
}

export function memoryWriteFailureResponse(result: Extract<MemoryWriteResult, { ok: false }>): NextResponse {
  if (result.code === "memory_version_conflict") {
    return maError(result.code, result.message, { current: currentDetails(result.current) });
  }
  if (result.code === "memory_path_conflict") {
    return maError(result.code, result.message, { conflicting_path: result.current?.path ?? null });
  }
  return maError(result.code, result.message);
}

export function parseMemoryListQuery(url: URL): {
  pathPrefix: string;
  depth?: number;
  view: "basic" | "full";
  limit: number;
  cursor?: string;
} {
  const viewRaw = url.searchParams.get("view") ?? "basic";
  if (viewRaw !== "basic" && viewRaw !== "full") throw new MaRequestError("view: must be basic or full");
  const view = viewRaw;
  const max = view === "full" ? 20 : 200;
  const limitRaw = url.searchParams.get("limit");
  let limit = view === "full" ? 20 : 50;
  if (limitRaw != null) {
    if (!/^[1-9]\d{0,8}$/.test(limitRaw)) throw new MaRequestError("limit: must be a positive integer");
    limit = Number(limitRaw);
    if (limit > max) {
      throw new MaRequestError(view === "full" ? "limit: must be at most 20 when view is full" : "limit: must be at most 200");
    }
  }
  const pathPrefix = url.searchParams.get("path_prefix") ?? "/";
  if (!pathPrefix.endsWith("/")) throw new MaRequestError('path_prefix: must end with "/"');
  const depthRaw = url.searchParams.get("depth");
  let depth: number | undefined;
  if (depthRaw != null && depthRaw !== "") {
    if (!/^\d{1,4}$/.test(depthRaw)) throw new MaRequestError("depth: must be an integer from 0 to 1024");
    depth = Number(depthRaw);
    if (depth > 1024) throw new MaRequestError("depth: must be an integer from 0 to 1024");
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  return { pathPrefix, depth, view, limit, cursor };
}

export function parseVersionListQuery(url: URL): { memoryId?: string; limit: number; cursor?: string } {
  const memoryId = url.searchParams.get("memory_id") ?? undefined;
  if (memoryId && !ULID_RE.test(memoryId)) throw new MaRequestError("memory_id: must be a ULID");
  const limitRaw = url.searchParams.get("limit");
  let limit = 50;
  if (limitRaw != null) {
    if (!/^[1-9]\d{0,8}$/.test(limitRaw)) throw new MaRequestError("limit: must be a positive integer");
    limit = Number(limitRaw);
    if (limit > 200) throw new MaRequestError("limit: must be at most 200");
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  return { memoryId, limit, cursor };
}

export function parsePositiveIntParam(raw: string | null, label: string): number | null {
  if (raw == null || raw === "") return null;
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new MaRequestError(`${label}: must be a positive integer`);
  return Number(raw);
}

export function memoryInternalDisabledResponse(): NextResponse | null {
  if (process.env.MA_MEMORY_INTERNAL_ENABLED === "0") {
    return noStore(
      NextResponse.json(
        { error: { code: "internal_error", message: "memory service is disabled" } },
        { status: 503 },
      ),
    );
  }
  return null;
}

export async function requireMountedMemorySession(
  tenantId: string,
  sessionId: string,
  storeId: string,
  need: "read" | "write",
): Promise<{ ok: true; createdByUserId: string | null } | { ok: false; response: NextResponse }> {
  const session = await getMaSession(tenantId, sessionId);
  if (!session) return { ok: false, response: noStore(maError("session_not_found", "session not found")) };
  if (session.status === "archived" || session.status === "terminated" || session.archivedAt) {
    return { ok: false, response: noStore(maError("session_terminated", "session is archived or terminated")) };
  }
  const mounted = session.resources.find(
    (item) => item.type === "memory_store" && item.memory_store_id === storeId,
  );
  if (!mounted) {
    return {
      ok: false,
      response: noStore(maError("forbidden_scope", "session does not mount this memory store")),
    };
  }
  switch (need) {
    case "read":
      break;
    case "write":
      if (mounted.access !== "read_write") {
        return {
          ok: false,
          response: noStore(maError("forbidden_scope", "memory store is mounted read_only")),
        };
      }
      break;
    default: {
      const unreachable: never = need;
      return { ok: false, response: noStore(maError("internal_error", String(unreachable))) };
    }
  }
  return { ok: true, createdByUserId: session.createdByUserId };
}

export function parseMemoryWriteOps(raw: unknown): ParsedMemoryOp[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) {
    throw new MaRequestError("ops must contain 1 to 50 items");
  }
  return raw.map((item) => parseMemoryWriteOp(item));
}

export function parseMemoryWriteOp(raw: unknown): ParsedMemoryOp {
  if (!isRecord(raw)) return { ok: false, message: "op must be an object" };
  if (raw.op === "create") {
    const unknown = unknownField(raw, ["op", "path", "content"]);
    if (unknown) return { ok: false, message: unknown };
    if (typeof raw.path !== "string" || typeof raw.content !== "string") {
      return { ok: false, message: "create requires path and content strings" };
    }
    return { ok: true, op: { op: "create", path: raw.path, content: raw.content } };
  }
  if (raw.op === "update") {
    const unknown = unknownField(raw, ["op", "memory_id", "expected_version", "path", "content"]);
    if (unknown) return { ok: false, message: unknown };
    if (typeof raw.memory_id !== "string") return { ok: false, message: "memory_id: must be a string" };
    const expected = readExpectedVersion(raw.expected_version);
    if (typeof expected === "string") return { ok: false, message: expected };
    if (raw.path !== undefined && typeof raw.path !== "string") return { ok: false, message: "path: must be a string" };
    if (raw.content !== undefined && typeof raw.content !== "string") return { ok: false, message: "content: must be a string" };
    return {
      ok: true,
      op: {
        op: "update",
        memoryId: raw.memory_id,
        expectedVersion: expected,
        ...(typeof raw.path === "string" ? { path: raw.path } : {}),
        ...(typeof raw.content === "string" ? { content: raw.content } : {}),
      },
    };
  }
  if (raw.op === "delete") {
    const unknown = unknownField(raw, ["op", "memory_id", "expected_version"]);
    if (unknown) return { ok: false, message: unknown };
    if (typeof raw.memory_id !== "string") return { ok: false, message: "memory_id: must be a string" };
    const expected = readExpectedVersion(raw.expected_version);
    if (typeof expected === "string") return { ok: false, message: expected };
    return { ok: true, op: { op: "delete", memoryId: raw.memory_id, expectedVersion: expected } };
  }
  return { ok: false, message: "op: must be create, update, or delete" };
}

export function publicMemoryListItem(
  item: { kind: "memory"; memory: MaMemory } | { kind: "memory_prefix"; path: string },
  view: "basic" | "full",
): { type: "memory" } & MemoryRecord | { type: "memory_prefix"; path: string } {
  if (item.kind === "memory_prefix") return { type: "memory_prefix", path: item.path };
  return { type: "memory", ...toMemoryRecord(item.memory, view === "full") };
}
