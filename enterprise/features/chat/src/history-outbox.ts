import { ulid } from "ulid";
import type {
  ChatMessage,
  ChatMessageDeepResearch,
  ChatMessageRole,
  WebSearchSource,
} from "@agenticx/core-api";
import { sanitizeWebSearchTrace } from "@agenticx/core-api";
import { ChatHistoryHttpError } from "./history-client";

const DB_NAME = "agx-portal-history-outbox-v1";
const STORE_OPS = "ops";
const STORE_META = "meta";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const MAX_ATTEMPTS = 8;
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
/** Fits truncated document parsed_text (~120k chars) + assistant turn + web sources. */
const MAX_JOB_BYTES = 1_000_000;
const MAX_QUEUE_BYTES = 8_000_000;
/** Align with portal MAX_ATTACHMENT_PARSED_TEXT_CHARS — keep preview + follow-up Q&A after refresh. */
const MAX_HISTORY_PARSED_TEXT_CHARS = 120_000;
/** Align with portal chat-message-sanitize MAX_DEEP_RESEARCH_EVENTS. */
const MAX_HISTORY_DEEP_RESEARCH_EVENTS = 200;
const LOCK_NAME_PREFIX = "agx-history-outbox:";

export type HistoryPrincipal = {
  tenantId: string;
  userId: string;
};

export type HistoryAppendAttachmentMeta = {
  name: string;
  mime_type: string;
  size?: number;
  kind?: "image" | "document" | "video";
  /** Truncated extracted text for document preview / follow-up after refresh. Never data_url. */
  parsed_text?: string;
  /** Original-file blob id — kept even when parsed_text is stripped for budget. */
  attachment_id?: string;
};

export type HistoryAppendPayload = {
  id: string;
  role: ChatMessageRole;
  content: string;
  model?: string;
  /** 本轮 x-agenticx-trace-id，供事后排障关联 Portal 日志。 */
  trace_id?: string;
  created_at: string;
  web_search_sources?: WebSearchSource[];
  web_search_trace?: ChatMessage["web_search_trace"];
  attachments?: HistoryAppendAttachmentMeta[];
  /** Deep-research workbench state — must survive refresh / session switch. */
  deep_research?: ChatMessageDeepResearch;
};

export type HistoryOutboxOp = {
  operation_id: string;
  principal: HistoryPrincipal;
  sessionId: string;
  mode: "append";
  messages: HistoryAppendPayload[];
  payload_hash: string;
  attempts: number;
  nextAttemptAt: number;
  state: "pending" | "paused" | "dead_letter";
  lastError?: string;
  createdAt: number;
  localSeq: number;
};

export type HistorySyncSessionState = {
  pendingCount: number;
  state: "syncing" | "waiting_retry" | "paused" | "dead_letter" | "idle";
  message?: string;
};

/**
 * The outbox briefly reports `syncing` after an append is queued. That is an
 * expected in-flight transition, not a history-sync warning; rendering it as
 * an alert makes every normal send flash a yellow banner before the operation
 * is removed from the outbox. Only states that require waiting, re-auth, or a
 * manual retry should reach the warning UI.
 */
export function shouldShowHistorySyncAlert(
  sync: HistorySyncSessionState | undefined,
): boolean {
  if (!sync || sync.pendingCount <= 0) return false;
  return (
    sync.state === "waiting_retry" ||
    sync.state === "paused" ||
    sync.state === "dead_letter"
  );
}

export type HistoryOutboxTransport = {
  appendMessages(
    sessionId: string,
    messages: HistoryAppendPayload[],
    opts: { operationId: string; payloadHash: string },
  ): Promise<void>;
};

export type HistoryOutboxHooks = {
  onSyncStateChange(bySessionId: Record<string, HistorySyncSessionState>): void;
  onFlushSuccess?(sessionIds: string[]): void | Promise<void>;
};

type MetaRow = {
  key: string;
  value: unknown;
};

export type HistoryOutboxStorage = {
  getOp(operationId: string): Promise<HistoryOutboxOp | undefined>;
  putOp(op: HistoryOutboxOp): Promise<void>;
  deleteOp(operationId: string): Promise<void>;
  listOps(): Promise<HistoryOutboxOp[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  putMeta(key: string, value: unknown): Promise<void>;
};

type CoordinatorState = {
  principal: HistoryPrincipal;
  transport: HistoryOutboxTransport;
  hooks?: HistoryOutboxHooks;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  disposed: boolean;
  visibilityHandler: (() => void) | null;
};

let coordinator: CoordinatorState | null = null;
let storageOverride: HistoryOutboxStorage | null = null;
let inTabFlushLock: Promise<void> | null = null;

export function __setHistoryOutboxStorageForTests(storage: HistoryOutboxStorage | null): void {
  storageOverride = storage;
}

export function __resetHistoryOutboxForTests(): void {
  if (coordinator?.timer) clearTimeout(coordinator.timer);
  if (coordinator?.visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", coordinator.visibilityHandler);
  }
  coordinator = null;
  storageOverride = null;
  inTabFlushLock = null;
}

export function createMemoryHistoryOutboxStorage(): HistoryOutboxStorage {
  const ops = new Map<string, HistoryOutboxOp>();
  const meta = new Map<string, unknown>();
  return {
    async getOp(operationId) {
      return ops.get(operationId);
    },
    async putOp(op) {
      ops.set(op.operation_id, structuredClone(op));
    },
    async deleteOp(operationId) {
      ops.delete(operationId);
    },
    async listOps() {
      return [...ops.values()].map((op) => structuredClone(op));
    },
    async getMeta<T>(key: string) {
      return meta.get(key) as T | undefined;
    },
    async putMeta(key: string, value: unknown) {
      meta.set(key, value);
    },
  };
}

function isValidUlid(id: string): boolean {
  return ULID_RE.test(id);
}

function principalKey(principal: HistoryPrincipal): string {
  return `${principal.tenantId}:${principal.userId}`;
}

function lockName(principal: HistoryPrincipal): string {
  return `${LOCK_NAME_PREFIX}${principalKey(principal)}`;
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempts));
}

function sortedCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedCanonical);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortedCanonical(obj[key]);
    }
    return out;
  }
  return value;
}

export async function computePayloadHash(messages: HistoryAppendPayload[]): Promise<string> {
  const canonical = JSON.stringify(sortedCanonical(messages));
  const data = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function stripToAppendPayload(message: ChatMessage): HistoryAppendPayload {
  if (!isValidUlid(message.id)) {
    throw new Error("invalid message id: must be a valid ULID");
  }
  const payload: HistoryAppendPayload = {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at: message.created_at,
  };
  if (message.model) payload.model = message.model;
  if (message.trace_id) payload.trace_id = message.trace_id;
  if (message.web_search_sources?.length) {
    // Rebuilt field by field so nothing unexpected is written back, which also
    // means every new field has to be added here explicitly. `publishedAt` was
    // added to the frame, the client mapper and the write validator and missed
    // here, so it reached the browser and was dropped on the way back — the
    // stored record showed no dates at all while the model was plainly being
    // shown them.
    payload.web_search_sources = message.web_search_sources.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      ...(typeof source.usedByModel === "boolean"
        ? { usedByModel: source.usedByModel }
        : {}),
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    }));
  }
  const webSearchTrace = sanitizeWebSearchTrace(message.web_search_trace);
  if (webSearchTrace) payload.web_search_trace = webSearchTrace;
  if (message.attachments?.length) {
    payload.attachments = message.attachments.map((item) => {
      const meta: HistoryAppendAttachmentMeta = {
        name: item.name,
        mime_type: item.mime_type,
        size: typeof item.size === "number" ? item.size : undefined,
        kind: item.kind,
      };
      // Persist truncated parsed_text so document chips stay previewable after refresh.
      // Never persist image data_url in history DTO (size + privacy).
      const parsed = item.parsed_text?.trim();
      if (parsed) {
        meta.parsed_text = parsed.slice(0, MAX_HISTORY_PARSED_TEXT_CHARS);
      }
      const attachmentId = item.attachment_id?.trim();
      if (attachmentId && isValidUlid(attachmentId)) {
        meta.attachment_id = attachmentId;
      }
      return meta;
    });
  }
  if (message.deep_research?.runId) {
    const events = Array.isArray(message.deep_research.events)
      ? message.deep_research.events.slice(-MAX_HISTORY_DEEP_RESEARCH_EVENTS)
      : [];
    payload.deep_research = {
      runId: message.deep_research.runId,
      status: message.deep_research.status,
      events,
      ...(message.deep_research.artifactIds?.length
        ? { artifactIds: message.deep_research.artifactIds.slice(0, 40) }
        : {}),
      ...(message.deep_research.clarifyAnswers
        ? { clarifyAnswers: message.deep_research.clarifyAnswers }
        : {}),
    };
  }
  return payload;
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const store = db.createObjectStore(STORE_OPS, { keyPath: "operation_id" });
        store.createIndex("byPrincipalSession", ["principal.tenantId", "principal.userId", "sessionId"], {
          unique: false,
        });
        store.createIndex("byNextAttempt", "nextAttemptAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function getIdbStorage(): Promise<HistoryOutboxStorage> {
  if (storageOverride) return storageOverride;
  const db = await openIndexedDb();
  return {
    async getOp(operationId) {
      const tx = db.transaction(STORE_OPS, "readonly");
      return idbReq(tx.objectStore(STORE_OPS).get(operationId)) as Promise<HistoryOutboxOp | undefined>;
    },
    async putOp(op) {
      const tx = db.transaction(STORE_OPS, "readwrite");
      await idbReq(tx.objectStore(STORE_OPS).put(op));
    },
    async deleteOp(operationId) {
      const tx = db.transaction(STORE_OPS, "readwrite");
      await idbReq(tx.objectStore(STORE_OPS).delete(operationId));
    },
    async listOps() {
      const tx = db.transaction(STORE_OPS, "readonly");
      return (await idbReq(tx.objectStore(STORE_OPS).getAll())) as HistoryOutboxOp[];
    },
    async getMeta<T>(key: string) {
      const tx = db.transaction(STORE_META, "readonly");
      const row = (await idbReq(tx.objectStore(STORE_META).get(key))) as MetaRow | undefined;
      return row?.value as T | undefined;
    },
    async putMeta(key: string, value: unknown) {
      const tx = db.transaction(STORE_META, "readwrite");
      await idbReq(tx.objectStore(STORE_META).put({ key, value } satisfies MetaRow));
    },
  };
}

function isSamePrincipal(a: HistoryPrincipal, b: HistoryPrincipal): boolean {
  return a.tenantId === b.tenantId && a.userId === b.userId;
}

async function listPrincipalOps(
  storage: HistoryOutboxStorage,
  principal: HistoryPrincipal,
): Promise<HistoryOutboxOp[]> {
  const all = await storage.listOps();
  return all.filter((op) => isSamePrincipal(op.principal, principal));
}

function tombstoneKey(principal: HistoryPrincipal): string {
  return `tombstones:${principalKey(principal)}`;
}

async function getTombstones(
  storage: HistoryOutboxStorage,
  principal: HistoryPrincipal,
): Promise<Set<string>> {
  const list = (await storage.getMeta<string[]>(tombstoneKey(principal))) ?? [];
  return new Set(list);
}

async function putTombstones(
  storage: HistoryOutboxStorage,
  principal: HistoryPrincipal,
  set: Set<string>,
): Promise<void> {
  await storage.putMeta(tombstoneKey(principal), [...set]);
}

function buildSyncState(ops: HistoryOutboxOp[]): Record<string, HistorySyncSessionState> {
  const bySession: Record<string, HistorySyncSessionState> = {};
  for (const op of ops) {
    const prev = bySession[op.sessionId] ?? {
      pendingCount: 0,
      state: "idle" as const,
    };
    const pendingCount = prev.pendingCount + 1;
    let state: HistorySyncSessionState["state"] = "waiting_retry";
    if (op.state === "paused") state = "paused";
    else if (op.state === "dead_letter") state = "dead_letter";
    else if (op.nextAttemptAt <= Date.now()) state = "syncing";
    const rank = { syncing: 1, waiting_retry: 2, paused: 3, dead_letter: 4, idle: 0 } as const;
    const nextState = rank[state] >= rank[prev.state] ? state : prev.state;
    bySession[op.sessionId] = {
      pendingCount,
      state: nextState,
      message:
        nextState === "dead_letter"
          ? op.lastError || "这段对话尚未同步到服务器，请稍后重试"
          : nextState === "paused"
            ? "登录状态已失效，重新登录后将继续同步"
            : "这段对话尚未同步到服务器，将自动重试",
    };
  }
  return bySession;
}

async function emitSyncState(state: CoordinatorState): Promise<void> {
  if (!state.hooks?.onSyncStateChange || state.disposed) return;
  const storage = await getIdbStorage();
  const ops = await listPrincipalOps(storage, state.principal);
  state.hooks.onSyncStateChange(buildSyncState(ops));
}

function scheduleNextFlush(state: CoordinatorState, delayMs: number): void {
  if (state.disposed) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushHistoryOutbox();
  }, Math.max(0, delayMs));
}

async function withOutboxLock<T>(
  principal: HistoryPrincipal,
  run: () => Promise<T>,
): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(lockName(principal), { mode: "exclusive" }, () => run());
  }
  // Best-effort same-tab single-flight when Web Locks API is unavailable.
  // Cross-tab mutual exclusion is not guaranteed without navigator.locks.
  while (inTabFlushLock) {
    await inTabFlushLock;
  }
  let release!: () => void;
  inTabFlushLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await run();
  } finally {
    release();
    inTabFlushLock = null;
  }
}

function classifyFlushError(error: unknown): "retry" | "pause" | "drop_session" | "dead" {
  if (error instanceof ChatHistoryHttpError) {
    if (error.status === 401) return "pause";
    if (error.status === 404) return "drop_session";
    if (error.status === 408 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504) {
      return "retry";
    }
    if (error.status === 400 || error.status === 403 || error.status === 409) return "dead";
    if (error.status >= 500) return "retry";
    return "dead";
  }
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes("failed to fetch") ||
      lower.includes("network") ||
      lower.includes("load failed") ||
      lower.includes("fetch failed") ||
      lower.includes("无法连接门户服务")
    ) {
      return "retry";
    }
  }
  return "retry";
}

async function flushOnce(state: CoordinatorState): Promise<string[]> {
  const storage = await getIdbStorage();
  const now = Date.now();
  const tombstones = await getTombstones(storage, state.principal);
  let ops = await listPrincipalOps(storage, state.principal);

  for (const op of ops) {
    if (now - op.createdAt > OUTBOX_TTL_MS && op.state !== "dead_letter") {
      op.state = "dead_letter";
      op.lastError = "同步队列已过期";
      await storage.putOp(op);
    }
  }
  ops = await listPrincipalOps(storage, state.principal);

  for (const sessionId of tombstones) {
    for (const op of ops.filter((item) => item.sessionId === sessionId)) {
      await storage.deleteOp(op.operation_id);
    }
  }
  ops = (await listPrincipalOps(storage, state.principal)).filter((op) => !tombstones.has(op.sessionId));

  const bySession = new Map<string, HistoryOutboxOp[]>();
  for (const op of ops) {
    const list = bySession.get(op.sessionId) ?? [];
    list.push(op);
    bySession.set(op.sessionId, list);
  }

  const succeededSessions = new Set<string>();
  let nextDelay = Number.POSITIVE_INFINITY;

  for (const [sessionId, sessionOps] of bySession) {
    sessionOps.sort((a, b) => a.localSeq - b.localSeq || a.createdAt - b.createdAt);
    for (const op of sessionOps) {
      if (op.state === "dead_letter") continue;
      if (op.state === "paused") continue;
      if (op.nextAttemptAt > now) {
        nextDelay = Math.min(nextDelay, op.nextAttemptAt - now);
        break;
      }

      try {
        await state.transport.appendMessages(sessionId, op.messages, {
          operationId: op.operation_id,
          payloadHash: op.payload_hash,
        });
        await storage.deleteOp(op.operation_id);
        succeededSessions.add(sessionId);
      } catch (error) {
        const kind = classifyFlushError(error);
        const message = error instanceof Error ? error.message : "同步失败";
        if (kind === "pause") {
          op.state = "paused";
          op.lastError = message;
          await storage.putOp(op);
          break;
        }
        if (kind === "drop_session") {
          if (tombstones.has(sessionId)) {
            for (const item of sessionOps) {
              await storage.deleteOp(item.operation_id);
            }
            break;
          }
          op.attempts += 1;
          if (op.attempts >= MAX_ATTEMPTS) {
            op.state = "dead_letter";
            op.lastError = message;
          } else {
            op.nextAttemptAt = now + backoffMs(op.attempts);
            op.lastError = message;
            nextDelay = Math.min(nextDelay, backoffMs(op.attempts));
          }
          await storage.putOp(op);
          break;
        }
        if (kind === "dead") {
          op.state = "dead_letter";
          op.lastError = message;
          await storage.putOp(op);
          break;
        }
        op.attempts += 1;
        if (op.attempts >= MAX_ATTEMPTS) {
          op.state = "dead_letter";
          op.lastError = message;
        } else {
          op.nextAttemptAt = now + backoffMs(op.attempts);
          op.lastError = message;
          nextDelay = Math.min(nextDelay, backoffMs(op.attempts));
        }
        await storage.putOp(op);
        break;
      }
    }
  }

  if (Number.isFinite(nextDelay)) {
    scheduleNextFlush(state, nextDelay);
  }
  await emitSyncState(state);
  return [...succeededSessions];
}

export function startHistoryOutboxCoordinator(
  principal: HistoryPrincipal,
  transport: HistoryOutboxTransport,
  hooks?: HistoryOutboxHooks,
): void {
  if (!principal.tenantId?.trim() || !principal.userId?.trim()) {
    throw new Error("history outbox requires tenantId and userId");
  }
  if (coordinator && !coordinator.disposed && isSamePrincipal(coordinator.principal, principal)) {
    coordinator.transport = transport;
    coordinator.hooks = hooks;
    return;
  }
  disposeHistoryOutbox();
  const state: CoordinatorState = {
    principal: { tenantId: principal.tenantId, userId: principal.userId },
    transport,
    hooks,
    timer: null,
    flushing: false,
    disposed: false,
    visibilityHandler: null,
  };
  coordinator = state;
  if (typeof document !== "undefined") {
    state.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void flushHistoryOutbox();
      }
    };
    document.addEventListener("visibilitychange", state.visibilityHandler);
  }
  void emitSyncState(state);
  void flushHistoryOutbox();
}

export function disposeHistoryOutbox(): void {
  if (!coordinator) return;
  if (coordinator.timer) clearTimeout(coordinator.timer);
  if (coordinator.visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", coordinator.visibilityHandler);
  }
  coordinator.disposed = true;
  coordinator = null;
}

export function getHistoryOutboxPrincipal(): HistoryPrincipal | null {
  return coordinator && !coordinator.disposed ? coordinator.principal : null;
}

export async function hasPendingAppendOps(sessionId: string): Promise<boolean> {
  if (!coordinator || coordinator.disposed) return false;
  const storage = await getIdbStorage();
  const ops = await listPrincipalOps(storage, coordinator.principal);
  return ops.some((op) => op.sessionId === sessionId && op.state !== "dead_letter");
}

export async function listPendingOverlayMessages(
  sessionId: string,
): Promise<ChatMessage[]> {
  if (!coordinator || coordinator.disposed) return [];
  const storage = await getIdbStorage();
  const ops = (await listPrincipalOps(storage, coordinator.principal))
    .filter((op) => op.sessionId === sessionId)
    .sort((a, b) => a.localSeq - b.localSeq || a.createdAt - b.createdAt);
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    for (const message of op.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push({
        id: message.id,
        session_id: sessionId,
        tenant_id: coordinator.principal.tenantId,
        user_id: coordinator.principal.userId,
        role: message.role,
        content: message.content,
        model: message.model,
        created_at: message.created_at,
        web_search_sources: message.web_search_sources,
        web_search_trace: sanitizeWebSearchTrace(message.web_search_trace),
        deep_research: message.deep_research,
        attachments: message.attachments?.map((item) => ({
          name: item.name,
          mime_type: item.mime_type,
          size: item.size,
          kind: item.kind,
          ...(item.parsed_text ? { parsed_text: item.parsed_text } : {}),
          ...(item.attachment_id ? { attachment_id: item.attachment_id } : {}),
        })),
      });
    }
  }
  return out;
}

export async function markSessionsDeleted(sessionIds: string[]): Promise<void> {
  if (!coordinator || coordinator.disposed) return;
  const storage = await getIdbStorage();
  const tombstones = await getTombstones(storage, coordinator.principal);
  for (const id of sessionIds) tombstones.add(id);
  await putTombstones(storage, coordinator.principal, tombstones);
  const ops = await listPrincipalOps(storage, coordinator.principal);
  for (const op of ops) {
    if (tombstones.has(op.sessionId)) {
      await storage.deleteOp(op.operation_id);
    }
  }
  await emitSyncState(coordinator);
}

export async function enqueueAppend(
  sessionId: string,
  messages: ChatMessage[],
  options?: { operationId?: string; payloadHash?: string },
): Promise<{ enqueued: boolean; reason?: string; operationId?: string }> {
  if (!coordinator || coordinator.disposed) {
    return { enqueued: false, reason: "outbox not started" };
  }
  const principal = coordinator.principal;
  let payloads: HistoryAppendPayload[];
  try {
    payloads = messages.map(stripToAppendPayload);
  } catch (error) {
    return {
      enqueued: false,
      reason: error instanceof Error ? error.message : "invalid append payload",
    };
  }

  const operationId = options?.operationId && isValidUlid(options.operationId) ? options.operationId : ulid();
  let payloadHash = options?.payloadHash ?? (await computePayloadHash(payloads));
  let jobBytes = utf8Bytes({ operationId, payloads, payloadHash });
  // If truncated parsed_text still blows the outbox budget, drop text and keep metadata chips.
  if (jobBytes > MAX_JOB_BYTES) {
    payloads = payloads.map((message) => ({
      ...message,
      attachments: message.attachments?.map((item) => ({
        name: item.name,
        mime_type: item.mime_type,
        size: item.size,
        kind: item.kind,
        // Keep attachment_id — last fallback for original preview after text drop.
        ...(item.attachment_id ? { attachment_id: item.attachment_id } : {}),
      })),
    }));
    payloadHash = await computePayloadHash(payloads);
    jobBytes = utf8Bytes({ operationId, payloads, payloadHash });
  }
  if (jobBytes > MAX_JOB_BYTES) {
    return { enqueued: false, reason: "附件或内容过大，无法加入离线同步队列" };
  }

  const storage = await getIdbStorage();
  const existing = await listPrincipalOps(storage, principal);
  const queueBytes = existing.reduce((sum, op) => sum + utf8Bytes(op), 0) + jobBytes;
  if (queueBytes > MAX_QUEUE_BYTES) {
    return { enqueued: false, reason: "离线同步队列已满，请恢复网络后重试" };
  }

  const sameSession = existing.filter((op) => op.sessionId === sessionId);
  const localSeq =
    sameSession.reduce((max, op) => Math.max(max, op.localSeq), 0) + 1;

  const op: HistoryOutboxOp = {
    operation_id: operationId,
    principal,
    sessionId,
    mode: "append",
    messages: payloads,
    payload_hash: payloadHash,
    attempts: 0,
    nextAttemptAt: Date.now(),
    state: "pending",
    createdAt: Date.now(),
    localSeq,
  };

  try {
    await storage.putOp(op);
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { enqueued: false, reason: "浏览器存储空间不足，无法加入离线同步队列" };
    }
    throw error;
  }

  await emitSyncState(coordinator);
  scheduleNextFlush(coordinator, 0);
  return { enqueued: true, operationId };
}

export async function resumePausedOps(): Promise<void> {
  if (!coordinator || coordinator.disposed) return;
  const storage = await getIdbStorage();
  const ops = await listPrincipalOps(storage, coordinator.principal);
  for (const op of ops) {
    if (op.state === "paused") {
      op.state = "pending";
      op.nextAttemptAt = Date.now();
      await storage.putOp(op);
    }
  }
  await emitSyncState(coordinator);
  await flushHistoryOutbox();
}

export async function flushHistoryOutbox(options?: { timeoutMs?: number }): Promise<string[]> {
  if (!coordinator || coordinator.disposed) return [];
  const state = coordinator;
  if (state.flushing) return [];

  const run = async (): Promise<string[]> => {
    state.flushing = true;
    try {
      return await flushOnce(state);
    } finally {
      state.flushing = false;
    }
  };

  const locked = withOutboxLock(state.principal, run);
  if (!options?.timeoutMs || options.timeoutMs <= 0) {
    const sessions = await locked;
    if (sessions.length && state.hooks?.onFlushSuccess) {
      await state.hooks.onFlushSuccess(sessions);
    }
    return sessions;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sessions = await Promise.race([
      locked,
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve([]), options.timeoutMs);
      }),
    ]);
    if (sessions.length && state.hooks?.onFlushSuccess) {
      await state.hooks.onFlushSuccess(sessions);
    }
    return sessions;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retryDeadLetter(sessionId: string): Promise<void> {
  if (!coordinator || coordinator.disposed) return;
  const storage = await getIdbStorage();
  const ops = await listPrincipalOps(storage, coordinator.principal);
  for (const op of ops) {
    if (op.sessionId === sessionId && op.state === "dead_letter") {
      op.state = "pending";
      op.attempts = 0;
      op.nextAttemptAt = Date.now();
      op.lastError = undefined;
      await storage.putOp(op);
    }
  }
  await emitSyncState(coordinator);
  await flushHistoryOutbox();
}
