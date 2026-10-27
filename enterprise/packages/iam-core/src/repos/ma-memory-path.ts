import { createHash } from "node:crypto";

export const MEMORY_PATH_MAX_BYTES = 1024;
export const MEMORY_SEGMENT_MAX_BYTES = 255;
export const MEMORY_CONTENT_MAX_BYTES = 102400;
export const MEMORY_STORE_MAX_ITEMS = 2000;
export const MEMORY_STORE_MAX_BYTES = 20 * 1024 * 1024;

const PATH_FORBIDDEN = /[\u0000-\u001f\u007f\\]/;
const LIMIT_MESSAGE = "memory store limit reached (2000 memories / 20 MiB)";
const VERSION_CONFLICT_MESSAGE = "memory has been modified";
const PATH_CONFLICT_MESSAGE = "path conflicts with an existing memory";

export class MaMemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaMemoryValidationError";
  }
}

export type MemoryActor =
  | { kind: "user"; userId: string | null }
  | { kind: "agent"; userId: string | null; sessionId: string };

export type MemoryWriteOp =
  | { op: "create"; path: string; content: string }
  | { op: "update"; memoryId: string; expectedVersion: number; path?: string; content?: string }
  | { op: "delete"; memoryId: string; expectedVersion: number };

export type MemoryHead = {
  id: string;
  path: string;
  version: number;
  contentSha256: string;
  sizeBytes: number;
  content: string;
};

export type MemoryPathRow = {
  id: string;
  path: string;
  version: number;
  contentSha256: string;
  sizeBytes: number;
};

export type MemoryWriteCurrent = {
  id: string;
  path: string;
  version: number;
  contentSha256: string;
};

export type MemoryWriteFailureCode =
  | "memory_version_conflict"
  | "memory_path_conflict"
  | "memory_not_found"
  | "memory_store_limit"
  | "invalid_request";

export type MemoryWriteMemory = {
  id: string;
  tenantId: string;
  storeId: string;
  path: string;
  contentSha256: string;
  sizeBytes: number;
  version: number;
  lastActorKind: "user" | "agent";
  lastActorUserId: string | null;
  lastSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  content?: string;
};

export type MemoryWriteResult =
  | { ok: true; memory: MemoryWriteMemory | null; version: number }
  | { ok: false; code: MemoryWriteFailureCode; message: string; current: MemoryWriteCurrent | null };

export type PlannedMemoryWrite =
  | {
      kind: "insert";
      path: string;
      pathHash: string;
      content: string;
      contentSha256: string;
      sizeBytes: number;
      version: 1;
      operation: "created";
    }
  | {
      kind: "update";
      memoryId: string;
      path: string;
      pathHash: string;
      content: string;
      contentSha256: string;
      sizeBytes: number;
      version: number;
      operation: "modified";
    }
  | {
      kind: "delete";
      memoryId: string;
      path: string;
      pathHash: string;
      version: number;
      operation: "deleted";
    }
  | { kind: "noop" }
  | {
      kind: "error";
      code: MemoryWriteFailureCode;
      message: string;
      current: MemoryWriteCurrent | null;
    };

export type MemoryActorColumns = {
  lastActorKind: "user" | "agent";
  lastActorUserId: string | null;
  lastSessionId: string | null;
  actorKind: "user" | "agent";
  actorUserId: string | null;
  sourceSessionId: string | null;
};

/** Returns the NFC-normalized path or throws MaMemoryValidationError. */
export function normalizeMemoryPath(raw: unknown): string {
  if (typeof raw !== "string") throw new MaMemoryValidationError("path: must be a string");
  const path = raw.normalize("NFC");
  if (!path.startsWith("/")) throw new MaMemoryValidationError('path: must start with "/"');
  if (path === "/") throw new MaMemoryValidationError("path: must not be the root");
  if (path.endsWith("/")) throw new MaMemoryValidationError('path: must not end with "/"');
  if (Buffer.byteLength(path, "utf8") > MEMORY_PATH_MAX_BYTES) {
    throw new MaMemoryValidationError("path: exceeds 1024 bytes");
  }
  if (PATH_FORBIDDEN.test(path)) {
    throw new MaMemoryValidationError("path: contains control characters or backslash");
  }
  const segments = path.slice(1).split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new MaMemoryValidationError('path: empty, "." or ".." segment');
    }
    if (Buffer.byteLength(segment, "utf8") > MEMORY_SEGMENT_MAX_BYTES) {
      throw new MaMemoryValidationError("path: segment exceeds 255 bytes");
    }
  }
  return path;
}

export function memoryPathHash(path: string): string {
  return createHash("sha256").update(Buffer.from(path, "utf8")).digest("hex");
}

export function contentSha256(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

export function validateMemoryContent(raw: unknown): { content: string; sizeBytes: number; sha256: string } {
  if (typeof raw !== "string") throw new MaMemoryValidationError("content: must be a string");
  if (raw.includes("\u0000")) throw new MaMemoryValidationError("content: must not contain NUL");
  const sizeBytes = Buffer.byteLength(raw, "utf8");
  if (sizeBytes > MEMORY_CONTENT_MAX_BYTES) throw new MaMemoryValidationError("content: exceeds 100 KiB");
  return { content: raw, sizeBytes, sha256: contentSha256(raw) };
}

/** Returns the conflicting existing path, or null. */
export function pathConflicts(candidate: string, existing: Iterable<string>, ignorePath?: string): string | null {
  for (const entry of existing) {
    if (entry === ignorePath) continue;
    if (entry === candidate || candidate.startsWith(`${entry}/`) || entry.startsWith(`${candidate}/`)) {
      return entry;
    }
  }
  return null;
}

export function memoryActorFields(actor: MemoryActor): MemoryActorColumns {
  switch (actor.kind) {
    case "user":
      return {
        lastActorKind: "user",
        lastActorUserId: actor.userId,
        lastSessionId: null,
        actorKind: "user",
        actorUserId: actor.userId,
        sourceSessionId: null,
      };
    case "agent":
      return {
        lastActorKind: "agent",
        lastActorUserId: actor.userId,
        lastSessionId: actor.sessionId,
        actorKind: "agent",
        actorUserId: actor.userId,
        sourceSessionId: actor.sessionId,
      };
    default: {
      const unreachable: never = actor;
      throw new Error(`unexpected actor ${(unreachable as { kind?: string }).kind ?? ""}`);
    }
  }
}

function snapshot(row: MemoryPathRow): MemoryWriteCurrent {
  return { id: row.id, path: row.path, version: row.version, contentSha256: row.contentSha256 };
}

function limitError(): PlannedMemoryWrite {
  return { kind: "error", code: "memory_store_limit", message: LIMIT_MESSAGE, current: null };
}

function pathError(rows: readonly MemoryPathRow[], conflictingPath: string): PlannedMemoryWrite {
  const row = rows.find((item) => item.path === conflictingPath) ?? null;
  return {
    kind: "error",
    code: "memory_path_conflict",
    message: PATH_CONFLICT_MESSAGE,
    current: row ? snapshot(row) : null,
  };
}

/**
 * Pure CAS planner. `totals` is the store's current count and byte total (including `current` when it exists).
 * Path and content validation still throw MaMemoryValidationError.
 */
export function planMemoryWrite(
  current: MemoryHead | null,
  op: MemoryWriteOp,
  allPaths: Iterable<MemoryPathRow>,
  totals: { count: number; totalBytes: number },
): PlannedMemoryWrite {
  const rows = [...allPaths];
  switch (op.op) {
    case "create": {
      const path = normalizeMemoryPath(op.path);
      const content = validateMemoryContent(op.content);
      const conflict = pathConflicts(path, rows.map((row) => row.path));
      if (conflict) return pathError(rows, conflict);
      if (totals.count + 1 > MEMORY_STORE_MAX_ITEMS || totals.totalBytes + content.sizeBytes > MEMORY_STORE_MAX_BYTES) {
        return limitError();
      }
      return {
        kind: "insert",
        path,
        pathHash: memoryPathHash(path),
        content: content.content,
        contentSha256: content.sha256,
        sizeBytes: content.sizeBytes,
        version: 1,
        operation: "created",
      };
    }
    case "update": {
      if (!current || current.id !== op.memoryId) {
        return { kind: "error", code: "memory_not_found", message: "memory not found", current: null };
      }
      if (current.version !== op.expectedVersion) {
        return {
          kind: "error",
          code: "memory_version_conflict",
          message: VERSION_CONFLICT_MESSAGE,
          current: snapshot(current),
        };
      }
      if (op.path === undefined && op.content === undefined) {
        return { kind: "error", code: "invalid_request", message: "path or content is required", current: null };
      }
      const path = op.path === undefined ? current.path : normalizeMemoryPath(op.path);
      const content = op.content === undefined
        ? { content: current.content, sizeBytes: current.sizeBytes, sha256: current.contentSha256 }
        : validateMemoryContent(op.content);
      if (path === current.path && content.sha256 === current.contentSha256) return { kind: "noop" };
      const conflict = pathConflicts(path, rows.map((row) => row.path), current.path);
      if (conflict) return pathError(rows, conflict);
      const nextTotal = totals.totalBytes - current.sizeBytes + content.sizeBytes;
      if (nextTotal > MEMORY_STORE_MAX_BYTES) return limitError();
      return {
        kind: "update",
        memoryId: current.id,
        path,
        pathHash: memoryPathHash(path),
        content: content.content,
        contentSha256: content.sha256,
        sizeBytes: content.sizeBytes,
        version: current.version + 1,
        operation: "modified",
      };
    }
    case "delete": {
      if (!current || current.id !== op.memoryId) {
        return { kind: "error", code: "memory_not_found", message: "memory not found", current: null };
      }
      if (current.version !== op.expectedVersion) {
        return {
          kind: "error",
          code: "memory_version_conflict",
          message: VERSION_CONFLICT_MESSAGE,
          current: snapshot(current),
        };
      }
      return {
        kind: "delete",
        memoryId: current.id,
        path: current.path,
        pathHash: memoryPathHash(current.path),
        version: current.version + 1,
        operation: "deleted",
      };
    }
    default: {
      const unreachable: never = op;
      throw new Error(`unexpected memory write ${(unreachable as { op?: string }).op ?? ""}`);
    }
  }
}
