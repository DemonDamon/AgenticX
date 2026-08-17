import type { AuthUser } from "@agenticx/auth";
import {
  buildAutoTitleFromFirstUserMessage,
  sanitizeWebSearchTrace,
  sessionTitleNeedsAutoFill,
  type ChatMessage,
  type ChatMessageRole,
  type ChatSession,
} from "@agenticx/core-api";
import { ulid } from "ulid";
import { randomBytes } from "node:crypto";
import { normalizeChatMessageOrder } from "../chat-message-order";
import {
  normalizeChatShareMessage,
  selectChatShareMessages,
  toChatShareMessage,
  type ChatShareMessage,
  type ChatShareSnapshot,
} from "../chat-share-types";
import {
  ChatHistoryConflictError,
  ChatHistoryNotFoundError,
  ChatShareValidationError,
  type AppendChatMessagesOptions,
  type ChatHistoryContext,
  type ChatHistoryStore,
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
const SHARE_TOKEN_BYTES = 24;
const MAX_SHARE_MESSAGES = 200;
const MAX_SHARE_CONTENT_CHARS = 500_000;
const HISTORY_PREVIEW_CHARS = 160;
const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

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

/** Keep internal reasoning searchable in message storage, but never render it in session cards. */
export function assistantHistoryPreview(value: unknown, max = HISTORY_PREVIEW_CHARS): string | undefined {
  if (value == null) return undefined;
  let text = String(value)
    .replaceAll(THINK_OPEN, "<think>")
    .replaceAll(THINK_CLOSE, "</think>");

  // Remove balanced blocks first. An orphan close still marks everything before
  // it as reasoning, while an unclosed open hides its unfinished tail.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const lower = text.toLowerCase();
  const lastOrphanClose = lower.lastIndexOf("</think>");
  if (lastOrphanClose >= 0) {
    text = text.slice(lastOrphanClose + "</think>".length);
  }
  const unclosedOpen = text.toLowerCase().indexOf("<think>");
  if (unclosedOpen >= 0) {
    text = text.slice(0, unclosedOpen);
  }
  return truncatePreview(text, max);
}

function mapSession(row: Record<string, unknown>): ChatSession {
  const assistantPreview = assistantHistoryPreview(
    row.assistant_preview_text ?? row.preview_text,
  );
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    title: String(row.title),
    active_model: row.active_model == null ? undefined : String(row.active_model),
    message_count: Number(row.message_count ?? 0),
    last_message_at: row.last_message_at == null ? undefined : toDate(row.last_message_at).toISOString(),
    pinned_at: row.pinned_at == null ? undefined : toDate(row.pinned_at).toISOString(),
    preview: assistantPreview ?? truncatePreview(row.user_preview_text),
    created_at: toDate(row.created_at).toISOString(),
    updated_at: toDate(row.updated_at).toISOString(),
  };
}

type MessageMetadata = {
  attachments?: ChatMessage["attachments"];
  web_search_sources?: ChatMessage["web_search_sources"];
  web_search_trace?: unknown;
  deep_research?: ChatMessage["deep_research"];
  trace_id?: string;
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
  const webSearchTrace = sanitizeWebSearchTrace(message.web_search_trace);
  if (webSearchTrace) {
    metadata.web_search_trace = webSearchTrace;
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
  // IMPORTANT: mysql2 + MySQL JSON columns reject JS objects here with
  // ER_INVALID_JSON_TEXT ("Invalid value." at position 1). Always pass a
  // JSON string (or null). PostgreSQL jsonb accepts the string equally well.
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
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
    web_search_trace: sanitizeWebSearchTrace(metadata?.web_search_trace),
    deep_research: metadata?.deep_research,
    model: row.model == null ? undefined : String(row.model),
    trace_id: metadata?.trace_id,
    created_at: toDate(row.created_at).toISOString(),
  };
}

function parseShareMessages(value: unknown): ChatShareMessage[] {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is ChatShareMessage => {
      if (!item || typeof item !== "object") return false;
      const message = item as Partial<ChatShareMessage>;
      return (
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        typeof message.created_at === "string"
      );
    })
    .map(normalizeChatShareMessage)
    .filter((message): message is ChatShareMessage => message !== null);
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

  public async listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]> {
    const p1 = this.dialect === "postgresql" ? "$1" : "?";
    const p2 = this.dialect === "postgresql" ? "$2" : "?";
    const assistantPreviewExpr =
      this.dialect === "postgresql"
        ? `nullif(btrim(case
             when strpos(lower(m.content), '</think>') > 0 then
               left(right(m.content, strpos(reverse(lower(m.content)), '>kniht/<') - 1), ${HISTORY_PREVIEW_CHARS})
             when strpos(lower(m.content), '<think>') > 0 then ''
             else left(m.content, ${HISTORY_PREVIEW_CHARS})
           end), '')`
        : `nullif(trim(case
             when locate('</think>', lower(m.content)) > 0 then
               left(right(m.content, locate('>kniht/<', reverse(lower(m.content))) - 1), ${HISTORY_PREVIEW_CHARS})
             when locate('<think>', lower(m.content)) > 0 then ''
             else left(m.content, ${HISTORY_PREVIEW_CHARS})
           end), '')`;
    const previewExpr = `
      (select ${assistantPreviewExpr} from chat_messages m
       where m.session_id = s.id and m.tenant_id = s.tenant_id and m.user_id = s.user_id
         and m.role = 'assistant'
       order by m.created_at asc limit 1) as assistant_preview_text,
      (select left(m.content, ${HISTORY_PREVIEW_CHARS}) from chat_messages m
       where m.session_id = s.id and m.tenant_id = s.tenant_id and m.user_id = s.user_id
         and m.role = 'user'
       order by m.created_at asc limit 1) as user_preview_text`;
    const orderBy =
      this.dialect === "postgresql"
        ? `(s.pinned_at is null) asc, s.pinned_at desc nulls last, s.created_at desc`
        : `(s.pinned_at is null) asc, s.pinned_at desc, s.created_at desc`;
    const result = await this.client.query(
      `select s.*, ${previewExpr}
       from chat_sessions s
       where s.tenant_id = ${p1}
         and s.user_id = ${p2}
         and s.deleted_at is null and s.message_count > 0
       order by ${orderBy}`,
      [ctx.tenantId, ctx.userId],
    );
    return result.rows.map(mapSession);
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

  private messagesEquivalent(existing: ChatMessage, incoming: ChatMessage): boolean {
    return (
      existing.role === incoming.role &&
      existing.content === incoming.content &&
      existing.created_at === incoming.created_at &&
      (existing.model ?? "") === (incoming.model ?? "")
    );
  }

  private isDeepResearchCheckpointUpdate(
    existing: ChatMessage,
    incoming: ChatMessage,
  ): boolean {
    const existingRunId = existing.deep_research?.runId;
    const incomingRunId = incoming.deep_research?.runId;
    return (
      existing.role === "assistant" &&
      incoming.role === "assistant" &&
      Boolean(existingRunId) &&
      Boolean(incomingRunId) &&
      (existingRunId === "pending" || existingRunId === incomingRunId)
    );
  }

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
        (!this.messagesEquivalent(mapped, message) &&
          !this.isDeepResearchCheckpointUpdate(mapped, message))
      ) {
        throw new ChatHistoryConflictError("message id conflict with different payload");
      }
    }
    if (existingCount === 0) return "none_exist";
    if (existingCount === messages.length) return "all_exist";
    throw new ChatHistoryConflictError("partial message id overlap");
  }

  /**
   * Refresh only an existing deep-research assistant shell. Ordinary same-id
   * messages retain strict immutable-payload idempotency.
   */
  private async updateDeepResearchCheckpoints(
    client: SqlClient,
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
    now: Date,
  ): Promise<void> {
    for (const message of messages) {
      if (message.role !== "assistant" || !message.deep_research?.runId) continue;
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
          serializeMessageMetadata(message),
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
        await this.updateDeepResearchCheckpoints(tx, ctx, sessionId, messages, now);
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

  public async replaceAllChatSessionMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    await this.client.transaction(async (tx) => {
      const session = await this.ownedSession(tx, ctx, sessionId, true);
      if (!session) throw new ChatHistoryNotFoundError();
      await tx.query(
        `delete from chat_messages where session_id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$3" : "?"}`,
        [sessionId, ctx.tenantId, ctx.userId],
      );
      const now = new Date();
      const lastAt = await this.insertMessages(tx, ctx, sessionId, messages, now);
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
    if (result.rowCount > 0) {
      const sharePlaceholders = this.placeholders(ids.length, 2);
      await this.client.query(
        `update chat_share_snapshots set revoked_at = ${this.dialect === "postgresql" ? "$1" : "?"}
         where tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}
           and session_id in (${sharePlaceholders})
           and revoked_at is null`,
        [now, ctx.tenantId, ...ids],
      );
    }
    return result.rowCount;
  }

  public async createChatShareSnapshot(
    ctx: ChatHistoryContext,
    sessionId: string,
    messageIds: string[],
  ): Promise<ChatShareSnapshot> {
    const session = await this.ownedSession(this.client, ctx, sessionId);
    if (!session) throw new ChatHistoryNotFoundError();

    const messages = await this.getChatSessionMessages(ctx, sessionId);
    const requestedIds = new Set(messageIds.map((id) => id.trim()).filter(Boolean));
    const shareMessages = messages
      .map(toChatShareMessage)
      .filter((message): message is ChatShareMessage => message !== null);
    const selected = selectChatShareMessages(shareMessages, requestedIds);

    if (selected.length === 0) {
      throw new ChatShareValidationError("select at least one message to share");
    }
    if (selected.length > MAX_SHARE_MESSAGES) {
      throw new ChatShareValidationError(`a share can contain at most ${MAX_SHARE_MESSAGES} messages`);
    }
    const contentLength = selected.reduce((sum, message) => sum + message.content.length, 0);
    if (contentLength > MAX_SHARE_CONTENT_CHARS) {
      throw new ChatShareValidationError("the selected messages are too large to share");
    }

    const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
    const createdAt = new Date();
    await this.client.query(
      `insert into chat_share_snapshots
       (token, session_id, tenant_id, user_id, title, messages, created_at, revoked_at)
       values (${this.placeholders(8)})`,
      [
        token,
        sessionId,
        ctx.tenantId,
        ctx.userId,
        String(session.title),
        JSON.stringify(selected),
        createdAt,
        null,
      ],
    );

    return {
      token,
      session_id: sessionId,
      title: String(session.title),
      messages: selected,
      created_at: createdAt.toISOString(),
    };
  }

  public async getChatShareSnapshot(token: string, tenantId?: string): Promise<ChatShareSnapshot | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken || normalizedToken.length > 64) return null;
    const tenantFilter = tenantId
      ? `\n         and sh.tenant_id = ${this.dialect === "postgresql" ? "$2" : "?"}`
      : "";
    const result = await this.client.query(
      `select sh.token, sh.session_id, sh.title, sh.messages, sh.created_at
       from chat_share_snapshots sh
       inner join chat_sessions s
         on s.id = sh.session_id
        and s.tenant_id = sh.tenant_id
        and s.user_id = sh.user_id
       where sh.token = ${this.dialect === "postgresql" ? "$1" : "?"}
         and sh.revoked_at is null
         and s.deleted_at is null${tenantFilter}
       limit 1`,
      tenantId ? [normalizedToken, tenantId] : [normalizedToken],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      token: String(row.token),
      session_id: String(row.session_id),
      title: String(row.title),
      messages: parseShareMessages(row.messages),
      created_at: toDate(row.created_at).toISOString(),
    };
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
