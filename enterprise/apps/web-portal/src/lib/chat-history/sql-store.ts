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
  ChatHistoryNotFoundError,
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

function normalizeRole(role: string): ChatMessageRole {
  if (ALLOWED_ROLES.includes(role as ChatMessageRole)) return role as ChatMessageRole;
  throw new Error(`invalid message role: ${role}`);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
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
    created_at: toDate(row.created_at).toISOString(),
    updated_at: toDate(row.updated_at).toISOString(),
  };
}

function parseMetadata(value: unknown): { attachments?: ChatMessage["attachments"] } | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as { attachments?: ChatMessage["attachments"] };
    } catch {
      return null;
    }
  }
  return value as { attachments?: ChatMessage["attachments"] };
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  const metadata = parseMetadata(row.metadata);
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    role: normalizeRole(String(row.role)),
    content: String(row.content),
    attachments: metadata?.attachments,
    model: row.model == null ? undefined : String(row.model),
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

  public async listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]> {
    const result = await this.client.query(
      `select * from chat_sessions
       where tenant_id = ${this.dialect === "postgresql" ? "$1" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$2" : "?"}
         and deleted_at is null and message_count > 0
       order by created_at desc`,
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
      params.push(
        ULID_RE.test(message.id) ? message.id : ulid(),
        sessionId,
        ctx.tenantId,
        ctx.userId,
        normalizeRole(message.role),
        message.content,
        message.model?.trim() || null,
        "complete",
        message.attachments?.length ? JSON.stringify({ attachments: message.attachments }) : null,
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

  public async appendChatMessages(
    ctx: ChatHistoryContext,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;
    await this.client.transaction(async (tx) => {
      const session = await this.ownedSession(tx, ctx, sessionId, true);
      if (!session) throw new ChatHistoryNotFoundError();
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
        [title, Number(session.message_count) + messages.length, lastAt, now, sessionId],
      );
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
    patch: { title?: string; activeModel?: string | null },
  ): Promise<ChatSession> {
    if (patch.title === undefined && patch.activeModel === undefined) {
      throw new Error("patch must include title or active_model");
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      params.push(value);
      fields.push(`${column} = ${this.dialect === "postgresql" ? `$${params.length}` : "?"}`);
    };
    if (patch.title !== undefined) add("title", patch.title.trim() || "New chat");
    if (patch.activeModel !== undefined) add("active_model", patch.activeModel?.trim() || null);
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
    const now = new Date();
    const result = await this.client.query(
      `update chat_sessions set deleted_at = ${this.dialect === "postgresql" ? "$1" : "?"},
       updated_at = ${this.dialect === "postgresql" ? "$2" : "?"}
       where id = ${this.dialect === "postgresql" ? "$3" : "?"}
         and tenant_id = ${this.dialect === "postgresql" ? "$4" : "?"}
         and user_id = ${this.dialect === "postgresql" ? "$5" : "?"}
         and deleted_at is null`,
      [now, now, sessionId, ctx.tenantId, ctx.userId],
    );
    if (result.rowCount === 0) throw new ChatHistoryNotFoundError();
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
