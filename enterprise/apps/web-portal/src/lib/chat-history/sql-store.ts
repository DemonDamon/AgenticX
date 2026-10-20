import type { AuthUser } from "@agenticx/auth";
import {
  buildAutoTitleFromFirstUserMessage,
  sessionTitleNeedsAutoFill,
  type ChatMessage,
  type ChatMessageRole,
  type ChatSession,
} from "@agenticx/core-api";
import { ulid } from "ulid";
import { normalizeChatMessageOrder } from "../chat-message-order";
import {
  ChatHistoryConflictError,
  ChatHistoryNotFoundError,
  type AppendChatMessagesOptions,
  type ChatHistoryContext,
  type ChatHistoryStore,
  type ChatSessionListCursor,
  type ChatSessionListPage,
} from "./types";

export type SqlDialect = "postgresql" | "mysql";

export type SqlResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
};

export interface SqlClient {
  query(statement: string, params?: unknown[]): Promise<SqlResult>;
  transaction<T>(callback: (client: SqlClient) => Promise<T>): Promise<T>;
  close(): void | Promise<void>;
}

const ALLOWED_ROLES: ChatMessageRole[] = ["system", "user", "assistant", "tool"];
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const WEB_FEEDBACK_COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "department_id",
  "session_id",
  "message_id",
  "value",
  "source",
  "external_session_id",
  "external_message_id",
  "trace_id",
  "provider",
  "model",
  "answer_excerpt",
  "created_at",
  "updated_at",
] as const;

function normalizeRole(role: string): ChatMessageRole {
  if (ALLOWED_ROLES.includes(role as ChatMessageRole)) return role as ChatMessageRole;
  throw new Error(`invalid message role: ${role}`);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function truncatePreview(value: unknown, max = 160): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Illegal cursors start over at the first page instead of skipping rows. */
function usableSessionListCursor(cursor: ChatSessionListCursor | null): ChatSessionListCursor | null {
  if (!cursor) return null;
  if (cursor.pinnedAt !== null && !isCanonicalIso(cursor.pinnedAt)) return null;
  if (!isCanonicalIso(cursor.createdAt) || !ULID_RE.test(cursor.id)) return null;
  return cursor;
}

function sessionPreviewSql(): string {
  return `coalesce(
             (select left(m.content, 160) from chat_messages m
              where m.session_id = s.id and m.tenant_id = s.tenant_id and m.user_id = s.user_id
                and m.role = 'assistant'
              order by m.created_at asc limit 1),
             (select left(m.content, 160) from chat_messages m
              where m.session_id = s.id and m.tenant_id = s.tenant_id and m.user_id = s.user_id
                and m.role = 'user'
              order by m.created_at asc limit 1)
           ) as preview_text`;
}

function mapSession(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    title: String(row.title),
    active_model: row.active_model == null ? undefined : String(row.active_model),
    message_count: Number(row.message_count ?? 0),
    last_message_at: row.last_message_at == null ? undefined : toDate(row.last_message_at).toISOString(),
    pinned_at: row.pinned_at == null ? undefined : toDate(row.pinned_at).toISOString(),
    preview: truncatePreview(row.preview_text),
    created_at: toDate(row.created_at).toISOString(),
    updated_at: toDate(row.updated_at).toISOString(),
  };
}

type MessageMetadata = {
  attachments?: ChatMessage["attachments"];
  web_search_sources?: ChatMessage["web_search_sources"];
  deep_research?: ChatMessage["deep_research"];
  trace_id?: string;
  interruption?: ChatMessage["interruption"];
};

function parseMetadata(value: unknown): MessageMetadata | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MessageMetadata;
    } catch {
      return null;
    }
  }
  return value as MessageMetadata;
}

/** Exported for unit tests — keep MySQL JSON binding semantics stable. */
export function serializeMessageMetadata(message: ChatMessage): string | null {
  const metadata: MessageMetadata = {};
  if (message.attachments?.length) {
    metadata.attachments = message.attachments;
  }
  if (message.web_search_sources?.length) {
    metadata.web_search_sources = message.web_search_sources;
  }
  if (message.deep_research) {
    const events = Array.isArray(message.deep_research.events)
      ? message.deep_research.events.slice(-200)
      : [];
    metadata.deep_research = { ...message.deep_research, events };
  }
  if (message.trace_id) {
    metadata.trace_id = message.trace_id;
  }
  if (message.interruption) metadata.interruption = message.interruption;
  // IMPORTANT: mysql2 + MySQL JSON columns reject JS objects here with
  // ER_INVALID_JSON_TEXT ("Invalid value." at position 1). Always pass a
  // JSON string (or null). PostgreSQL jsonb accepts the string equally well.
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

/**
 * Ordinary answers may continue from the saved prefix. A completed row (no
 * interruption) cannot be rewritten, and cannot be marked disconnected again.
 */
export function ordinaryAssistantUpdateAllowed(existing: ChatMessage, incoming: ChatMessage): boolean {
  if (existing.model !== incoming.model) return false;
  if (incoming.interruption?.reason === "disconnected" && !existing.interruption) return false;
  const length = existing.interruption?.contentLength;
  if (existing.interruption) {
    if (length == null || !Number.isInteger(length) || length < 0 || length > existing.content.length) return false;
    return incoming.content.startsWith(existing.content.slice(0, length));
  }
  return existing.content === incoming.content && !incoming.interruption;
}

/** Exported for unit tests — keep metadata.trace_id round-trip stable. */
export function mapMessage(row: Record<string, unknown>): ChatMessage {
  const metadata = parseMetadata(row.metadata);
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    role: normalizeRole(String(row.role)),
    content: String(row.content),
    attachments: metadata?.attachments,
    web_search_sources: metadata?.web_search_sources,
    deep_research: metadata?.deep_research,
    model: row.model == null ? undefined : String(row.model),
    trace_id: metadata?.trace_id,
    interruption: metadata?.interruption,
    created_at: toDate(row.created_at).toISOString(),
  };
}

export class SqlChatHistoryStore implements ChatHistoryStore {
  public constructor(
    private readonly dialect: SqlDialect,
    private readonly client: SqlClient,
  ) {}

  private placeholders(count: number, offset = 0): string {
    return Array.from({ length: count }, (_, index) =>
      this.dialect === "postgresql" ? `$${offset + index + 1}` : "?",
    ).join(", ");
  }

  private async ownedSession(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    lock = false,
  ): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `select * from chat_sessions
       where id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$3" : "?"}
         and deleted_at is null
       limit 1${lock ? " for update" : ""}`,
      [sessionId, ctx.tenantId, ctx.userId],
    );
    return result.rows[0] ?? null;
  }

  public async isChatSessionOwned(ctx: ChatHistoryContext, sessionId: string): Promise<boolean> {
    return (await this.ownedSession(this.client, ctx, sessionId)) !== null;
  }

  private sessionListOrderBy(withIdTieBreak: boolean): string {
    const tie = withIdTieBreak ? ", s.id desc" : "";
    return this.dialect === "postgresql"
      ? `(s.pinned_at is null) asc, s.pinned_at desc nulls last, s.created_at desc${tie}`
      : `(s.pinned_at is null) asc, s.pinned_at desc, s.created_at desc${tie}`;
  }

  public async listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]> {
    const p1 = this.dialect === "postgresql" ? "$1" : "?";
    const p2 = this.dialect === "postgresql" ? "$2" : "?";
    const result = await this.client.query(
      `select s.*, ${sessionPreviewSql()}
       from chat_sessions s
       where s.tenant_id = ${p1}
         and s.user_id = ${p2}
         and s.deleted_at is null and s.message_count > 0
       order by ${this.sessionListOrderBy(false)}`,
      [ctx.tenantId, ctx.userId],
    );
    return result.rows.map(mapSession);
  }

  public async getChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<ChatSession> {
    const result = await this.client.query(
      `select s.*, ${sessionPreviewSql()}
       from chat_sessions s
       where s.id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and s.tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and s.user_id = ${this.dialect === "postgresql" ? "$3" : "?"}
         and s.deleted_at is null and s.message_count > 0
       limit 1`,
      [sessionId, ctx.tenantId, ctx.userId],
    );
    const row = result.rows[0];
    if (!row) throw new ChatHistoryNotFoundError();
    return mapSession(row);
  }

  public async listChatSessionsPage(
    ctx: ChatHistoryContext,
    input: { limit: number; cursor: ChatSessionListCursor | null },
  ): Promise<ChatSessionListPage> {
    const params: unknown[] = [];
    const param = (value: unknown): string => {
      params.push(value);
      return this.dialect === "postgresql" ? `$${params.length}` : "?";
    };
    const tenant = param(ctx.tenantId);
    const user = param(ctx.userId);
    const beforeCreated = (cursor: ChatSessionListCursor) => {
      const createdAt = new Date(cursor.createdAt);
      return `(s.created_at < ${param(createdAt)} or
        (s.created_at = ${param(createdAt)} and s.id < ${param(cursor.id)}))`;
    };
    const cursor = usableSessionListCursor(input.cursor);
    let cursorFilter = "";
    if (cursor?.pinnedAt) {
      const pinnedAt = new Date(cursor.pinnedAt);
      cursorFilter = `and (s.pinned_at is null or s.pinned_at < ${param(pinnedAt)} or
        (s.pinned_at = ${param(pinnedAt)} and ${beforeCreated(cursor)}))`;
    } else if (cursor) {
      cursorFilter = `and s.pinned_at is null and ${beforeCreated(cursor)}`;
    }
    const limit = param(input.limit + 1);
    const orderBy = this.sessionListOrderBy(true);
    const result = await this.client.query(
      `select s.*, ${sessionPreviewSql()}
       from (
         select * from chat_sessions s
         where s.tenant_id = ${tenant} and s.user_id = ${user}
           and s.deleted_at is null and s.message_count > 0
           ${cursorFilter}
         order by ${orderBy}
         limit ${limit}
       ) s
       order by ${orderBy}`,
      params,
    );
    const sessions = result.rows.slice(0, input.limit).map(mapSession);
    const last = result.rows.length > input.limit ? sessions.at(-1) : undefined;
    return {
      sessions,
      nextCursor: last
        ? { pinnedAt: last.pinned_at ?? null, createdAt: last.created_at, id: last.id }
        : null,
    };
  }

  public async createChatSession(
    ctx: ChatHistoryContext,
    input: { title: string; activeModel?: string },
  ): Promise<ChatSession> {
    const id = ulid();
    const now = new Date();
    await this.client.query(
      `insert into chat_sessions
       (id, tenant_id, user_id, title, active_model, message_count, last_message_at, deleted_at, created_at, updated_at)
       values (${this.placeholders(10)})`,
      [
        id,
        ctx.tenantId,
        ctx.userId,
        input.title.trim() || "New chat",
        input.activeModel?.trim() || null,
        0,
        null,
        null,
        now,
        now,
      ],
    );
    const row = await this.ownedSession(this.client, ctx, id);
    if (!row) throw new Error("failed to create session");
    return mapSession(row);
  }

  public async getChatSessionMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
  ): Promise<ChatMessage[]> {
    if (!(await this.isChatSessionOwned(ctx, sessionId))) throw new ChatHistoryNotFoundError();
    const result = await this.client.query(
      `select * from chat_messages
       where session_id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$3" : "?"}
       order by created_at asc, id asc`,
      [sessionId, ctx.tenantId, ctx.userId],
    );
    return normalizeChatMessageOrder(result.rows.map(mapMessage));
  }

  private messageValues(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    now: Date,
  ): { params: unknown[]; lastAt: Date | null } {
    const params: unknown[] = [];
    let lastAt: Date | null = null;
    for (const message of messages) {
      const createdAt = message.created_at ? new Date(message.created_at) : now;
      lastAt = createdAt;
      if (!ULID_RE.test(message.id)) {
        throw new Error("invalid message id: must be a valid ULID");
      }
      params.push(
        message.id,
        sessionId,
        ctx.tenantId,
        ctx.userId,
        normalizeRole(message.role),
        message.content,
        message.model?.trim() || null,
        "complete",
        serializeMessageMetadata(message),
        createdAt,
        createdAt,
      );
    }
    return { params, lastAt };
  }

  private async insertMessages(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    now: Date,
  ): Promise<Date | null> {
    if (messages.length === 0) return null;
    const { params, lastAt } = this.messageValues(ctx, sessionId, messages, now);
    const rows = messages
      .map(() => `(${this.placeholders(11, this.dialect === "postgresql" ? params.length : 0)})`)
      .join(", ");
    if (this.dialect === "postgresql") {
      let offset = 0;
      const pgRows = messages
        .map(() => {
          const row = `(${this.placeholders(11, offset)})`;
          offset += 11;
          return row;
        })
        .join(", ");
      await client.query(
        `insert into chat_messages
         (id, session_id, tenant_id, user_id, role, content, model, status, metadata, created_at, updated_at)
         values ${pgRows}`,
        params,
      );
    } else {
      await client.query(
        `insert into chat_messages
         (id, session_id, tenant_id, user_id, role, content, model, status, metadata, created_at, updated_at)
         values ${rows}`,
        params,
      );
    }
    return lastAt;
  }

  private async refreshSessionStats(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    title: string,
    now: Date,
  ): Promise<void> {
    const p = this.dialect === "postgresql";
    const stats = await client.query(
      this.dialect === "postgresql"
        ? `select count(*)::int as message_count, max(created_at) as last_message_at
           from chat_messages
           where session_id = $1 and tenant_id = $2 and user_id = $3`
        : `select count(*) as message_count, max(created_at) as last_message_at
           from chat_messages
           where session_id = ? and tenant_id = ? and user_id = ?`,
      [sessionId, ctx.tenantId, ctx.userId],
    );
    const row = stats.rows[0] ?? {};
    await client.query(
      `update chat_sessions set title = ${p ? "$1" : "?"},
        message_count = ${p ? "$2" : "?"},
        last_message_at = ${p ? "$3" : "?"},
        updated_at = ${p ? "$4" : "?"}
       where id = ${p ? "$5" : "?"}
         and tenant_id = ${p ? "$6" : "?"}
         and user_id = ${p ? "$7" : "?"}`,
      [
        title,
        Number(row.message_count ?? 0),
        row.last_message_at == null ? null : toDate(row.last_message_at),
        now,
        sessionId,
        ctx.tenantId,
        ctx.userId,
      ],
    );
  }

  /**
   * Owned same-id rows may receive checkpoint updates (content / model / metadata).
   * Cross-session or cross-principal reuse of an id remains a hard conflict.
   */
  private async ensureMessagesCompatible(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<"all_exist" | "none_exist"> {
    let existingCount = 0;
    for (const message of messages) {
      const result = await client.query(
        `select * from chat_messages
         where id = ${this.dialect === "postgresql" ? "$1" : "?"}
         limit 1`,
        [message.id],
      );
      const row = result.rows[0];
      if (!row) continue;
      existingCount += 1;
      const mapped = mapMessage(row);
      if (
        mapped.session_id !== sessionId ||
        mapped.tenant_id !== ctx.tenantId ||
        mapped.user_id !== ctx.userId ||
        mapped.role !== message.role
      ) {
        throw new ChatHistoryConflictError("message id conflict with different payload");
      }
      // created_at is immutable identity for the turn; drifting it is treated as conflict.
      if (mapped.created_at !== message.created_at) {
        throw new ChatHistoryConflictError("message id conflict with different payload");
      }
      // Late snapshots must not make a completed ordinary answer resumable again,
      // and an interrupted answer may only grow from its saved prefix.
      if (
        mapped.role === "assistant" &&
        message.role === "assistant" &&
        !mapped.deep_research &&
        !message.deep_research &&
        !ordinaryAssistantUpdateAllowed(mapped, message)
      ) {
        throw new ChatHistoryConflictError("message id conflict with different payload");
      }
    }
    if (existingCount === 0) return "none_exist";
    if (existingCount === messages.length) return "all_exist";
    throw new ChatHistoryConflictError("partial message id overlap");
  }

  /** Upsert content/model/metadata for an already-inserted owned message (deep-research checkpoints). */
  private async updateMessagesCheckpoint(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    now: Date,
  ): Promise<void> {
    for (const message of messages) {
      const metadata = serializeMessageMetadata(message);
      await client.query(
        `update chat_messages
         set content = ${this.dialect === "postgresql" ? "$1" : "?"},
             model = ${this.dialect === "postgresql" ? "$2" : "?"},
             metadata = ${this.dialect === "postgresql" ? "$3" : "?"},
             updated_at = ${this.dialect === "postgresql" ? "$4" : "?"}
         where id = ${this.dialect === "postgresql" ? "$5" : "?"}
           and session_id = ${this.dialect === "postgresql" ? "$6" : "?"}
           and tenant_id = ${this.dialect === "postgresql" ? "$7" : "?"}
           and user_id = ${this.dialect === "postgresql" ? "$8" : "?"}`,
        [
          message.content,
          message.model ?? null,
          metadata,
          now,
          message.id,
          sessionId,
          ctx.tenantId,
          ctx.userId,
        ],
      );
    }
  }

  public async appendChatMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    options?: AppendChatMessagesOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    const operationId = options?.operationId?.trim() || undefined;
    const payloadHash = options?.payloadHash?.trim() || undefined;
    if (operationId) {
      if (!ULID_RE.test(operationId)) {
        throw new Error("invalid operation_id: must be a valid ULID");
      }
      if (!payloadHash || !/^[a-f0-9]{64}$/i.test(payloadHash)) {
        throw new Error("invalid payload_hash: must be sha256 hex");
      }
    }

    await this.client.transaction(async (tx) => {
      const session = await this.ownedSession(tx, ctx, sessionId, true);
      if (!session) throw new ChatHistoryNotFoundError();
      const now = new Date();

      if (operationId && payloadHash) {
        const existingOp = await tx.query(
          `select operation_id, payload_hash, session_id, tenant_id, user_id
           from chat_history_operations
           where operation_id = ${this.dialect === "postgresql" ? "$1" : "?"}
           limit 1`,
          [operationId],
        );
        const opRow = existingOp.rows[0];
        if (opRow) {
          if (
            String(opRow.payload_hash).toLowerCase() !== payloadHash.toLowerCase() ||
            String(opRow.session_id) !== sessionId ||
            String(opRow.tenant_id) !== ctx.tenantId ||
            String(opRow.user_id) !== ctx.userId
          ) {
            throw new ChatHistoryConflictError("operation_id conflict with different payload");
          }
          return;
        }
      }

      const compatibility = await this.ensureMessagesCompatible(tx, ctx, sessionId, messages);
      if (compatibility === "none_exist") {
        await this.insertMessages(tx, ctx, sessionId, messages, now);
      } else {
        // Same ids already persisted (e.g. deep-research early shell) — refresh
        // content + deep_research metadata so mid-run refresh can restore the turn.
        await this.updateMessagesCheckpoint(tx, ctx, sessionId, messages, now);
      }

      if (operationId && payloadHash) {
        await tx.query(
          `insert into chat_history_operations
           (operation_id, tenant_id, user_id, session_id, payload_hash, created_at)
           values (${this.placeholders(6)})`,
          [operationId, ctx.tenantId, ctx.userId, sessionId, payloadHash.toLowerCase(), now],
        );
      }

      const firstUser = messages.find((message) => message.role === "user");
      const title =
        firstUser && sessionTitleNeedsAutoFill(String(session.title))
          ? buildAutoTitleFromFirstUserMessage(firstUser.content) || String(session.title)
          : String(session.title);
      await this.refreshSessionStats(tx, ctx, sessionId, title, now);
    });
  }

  /**
   * message_id is ON DELETE CASCADE, so replacing a session's messages would
   * drop every vote in that session. Snapshot web votes first and put back
   * the ones whose message still exists after the rewrite.
   */
  private feedbackTableExists = false;

  /** Editing must keep working while a deployment has not run the feedback migration yet. */
  private async hasFeedbackTable(client: SqlClient): Promise<boolean> {
    if (this.feedbackTableExists) return true;
    const result =
      this.dialect === "postgresql"
        ? await client.query(`select to_regclass('chat_message_feedback') is not null as present`, [])
        : await client.query(
            `select count(*) as present from information_schema.tables
             where table_schema = database() and table_name = 'chat_message_feedback'`,
            [],
          );
    const present = result.rows[0]?.present;
    this.feedbackTableExists = present === true || Number(present) > 0;
    return this.feedbackTableExists;
  }

  private async snapshotWebFeedback(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
  ): Promise<Record<string, unknown>[]> {
    if (!(await this.hasFeedbackTable(client))) return [];
    const p = this.dialect === "postgresql";
    const result = await client.query(
      `select ${WEB_FEEDBACK_COLUMNS.join(", ")}
       from chat_message_feedback
       where tenant_id = ${p ? "$1" : "?"}
         and user_id = ${p ? "$2" : "?"}
         and session_id = ${p ? "$3" : "?"}
         and source = 'web'`,
      [ctx.tenantId, ctx.userId, sessionId],
    );
    return result.rows;
  }

  private async restoreWebFeedback(
    client: SqlClient,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const width = WEB_FEEDBACK_COLUMNS.length;
    const params: unknown[] = [];
    for (const row of rows) {
      for (const column of WEB_FEEDBACK_COLUMNS) {
        params.push(row[column] ?? null);
      }
    }
    const columnList = WEB_FEEDBACK_COLUMNS.join(", ");
    if (this.dialect === "postgresql") {
      let offset = 0;
      const values = rows
        .map(() => {
          const tuple = `(${this.placeholders(width, offset)})`;
          offset += width;
          return tuple;
        })
        .join(", ");
      await client.query(
        `insert into chat_message_feedback (${columnList}) values ${values}`,
        params,
      );
      return;
    }
    const values = rows.map(() => `(${this.placeholders(width)})`).join(", ");
    await client.query(
      `insert into chat_message_feedback (${columnList}) values ${values}`,
      params,
    );
  }

  public async replaceAllChatSessionMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    await this.client.transaction(async (tx) => {
      const session = await this.ownedSession(tx, ctx, sessionId, true);
      if (!session) throw new ChatHistoryNotFoundError();
      const feedbackRows = await this.snapshotWebFeedback(tx, ctx, sessionId);
      await tx.query(
        `delete from chat_messages where session_id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$3" : "?"}`,
        [sessionId, ctx.tenantId, ctx.userId],
      );
      const now = new Date();
      const lastAt = await this.insertMessages(tx, ctx, sessionId, messages, now);
      const survivingIds = new Set(messages.map((message) => message.id));
      await this.restoreWebFeedback(
        tx,
        feedbackRows.filter((row) => {
          const messageId = row.message_id == null ? "" : String(row.message_id);
          return messageId.length > 0 && survivingIds.has(messageId);
        }),
      );
      const firstUser = messages.find((message) => message.role === "user");
      const title =
        firstUser && sessionTitleNeedsAutoFill(String(session.title))
          ? buildAutoTitleFromFirstUserMessage(firstUser.content) || String(session.title)
          : String(session.title);
      await tx.query(
        `update chat_sessions set title = ${this.dialect === "postgresql" ? "$1" : "?"},
          message_count = ${this.dialect === "postgresql" ? "$2" : "?"},
          last_message_at = ${this.dialect === "postgresql" ? "$3" : "?"},
          updated_at = ${this.dialect === "postgresql" ? "$4" : "?"}
         where id = ${this.dialect === "postgresql" ? "$5" : "?"}`,
        [title, messages.length, lastAt, now, sessionId],
      );
    });
  }

  public async patchChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    patch: { title?: string; activeModel?: string | null; pinned?: boolean },
  ): Promise<ChatSession> {
    if (
      patch.title === undefined &&
      patch.activeModel === undefined &&
      patch.pinned === undefined
    ) {
      throw new Error("patch must include title, active_model, or pinned");
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      params.push(value);
      fields.push(`${column} = ${this.dialect === "postgresql" ? `$${params.length}` : "?"}`);
    };
    if (patch.title !== undefined) add("title", patch.title.trim() || "New chat");
    if (patch.activeModel !== undefined) add("active_model", patch.activeModel?.trim() || null);
    if (patch.pinned === true) add("pinned_at", new Date());
    else if (patch.pinned === false) add("pinned_at", null);
    add("updated_at", new Date());
    params.push(sessionId, ctx.tenantId, ctx.userId);
    const base = params.length - 3;
    const result = await this.client.query(
      `update chat_sessions set ${fields.join(", ")}
       where id = ${this.dialect === "postgresql" ? `$${base + 1}` : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? `$${base + 2}` : "?"}
         and user_id = ${this.dialect === "postgresql" ? `$${base + 3}` : "?"}
         and deleted_at is null`,
      params,
    );
    if (result.rowCount === 0) throw new ChatHistoryNotFoundError();
    const row = await this.ownedSession(this.client, ctx, sessionId);
    if (!row) throw new ChatHistoryNotFoundError();
    return mapSession(row);
  }

  public renameChatSession(
    ctx: ChatHistoryContext,
    sessionId: string,
    title: string,
  ): Promise<ChatSession> {
    return this.patchChatSession(ctx, sessionId, { title });
  }

  public async softDeleteChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<void> {
    const deleted = await this.softDeleteChatSessions(ctx, [sessionId]);
    if (deleted === 0) throw new ChatHistoryNotFoundError();
  }

  public async softDeleteChatSessions(ctx: ChatHistoryContext, sessionIds: string[]): Promise<number> {
    const ids = [...new Set(sessionIds.map((id) => id.trim()).filter((id) => ULID_RE.test(id)))];
    if (ids.length === 0) return 0;
    const now = new Date();
    // $1 deleted_at, $2 updated_at, $3 tenant, $4 user, $5… ids
    const placeholders = this.placeholders(ids.length, 4);
    const result = await this.client.query(
      `update chat_sessions set deleted_at = ${this.dialect === "postgresql" ? "$1" : "?"},
       updated_at = ${this.dialect === "postgresql" ? "$2" : "?"}
       where tenant_id = ${this.dialect === "postgresql" ? "$3" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$4" : "?"}
         and deleted_at is null
         and id in (${placeholders})`,
      [now, now, ctx.tenantId, ctx.userId, ...ids],
    );
    return result.rowCount;
  }

  public async syncAuthUser(user: AuthUser): Promise<void> {
    if (!process.env.DATABASE_URL?.trim()) return;
    const params = [
      user.id,
      user.tenantId,
      user.deptId ?? null,
      user.email.toLowerCase(),
      user.displayName,
      user.passwordHash,
      user.status,
    ];
    if (this.dialect === "postgresql") {
      await this.client.query(
        `insert into users (id, tenant_id, dept_id, email, display_name, password_hash, status)
         values (${this.placeholders(7)})
         on conflict (id) do update set dept_id = excluded.dept_id, email = excluded.email,
           display_name = excluded.display_name, password_hash = excluded.password_hash,
           status = excluded.status, updated_at = now()`,
        params,
      );
    } else {
      await this.client.query(
        `insert into users (id, tenant_id, dept_id, email, display_name, password_hash, status)
         values (${this.placeholders(7)})
         on duplicate key update dept_id = values(dept_id), email = values(email),
           display_name = values(display_name), password_hash = values(password_hash),
           status = values(status), updated_at = current_timestamp(6)`,
        params,
      );
    }
  }

  public resetForTests(): void | Promise<void> {
    return this.client.close();
  }
}
