import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { SqlChatHistoryStore, type SqlClient, type SqlResult } from "./sql-store";
import { ChatHistoryConflictError } from "./types";

type Row = Record<string, unknown>;

function createFakeClient(): SqlClient & {
  sessions: Map<string, Row>;
  messages: Map<string, Row>;
  operations: Map<string, Row>;
} {
  const sessions = new Map<string, Row>();
  const messages = new Map<string, Row>();
  const operations = new Map<string, Row>();

  const client: SqlClient & {
    sessions: Map<string, Row>;
    messages: Map<string, Row>;
    operations: Map<string, Row>;
  } = {
    sessions,
    messages,
    operations,
    async query(statement: string, params: unknown[] = []): Promise<SqlResult> {
      const sql = statement.replace(/\s+/g, " ").trim().toLowerCase();

      if (sql.startsWith("select * from chat_sessions")) {
        const id = String(params[0] ?? "");
        const tenantId = String(params[1] ?? "");
        const userId = String(params[2] ?? "");
        const row = sessions.get(id);
        if (
          row &&
          row.tenant_id === tenantId &&
          row.user_id === userId &&
          row.deleted_at == null
        ) {
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from chat_history_operations") && sql.includes("where operation_id")) {
        const operationId = String(params[0] ?? "");
        const row = operations.get(operationId);
        return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("select * from chat_messages") && sql.includes("where id")) {
        const id = String(params[0] ?? "");
        const row = messages.get(id);
        return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("insert into chat_messages")) {
        // values: id, session, tenant, user, role, content, model, status, metadata, created, updated
        for (let i = 0; i + 10 < params.length; i += 11) {
          const id = String(params[i]);
          messages.set(id, {
            id,
            session_id: params[i + 1],
            tenant_id: params[i + 2],
            user_id: params[i + 3],
            role: params[i + 4],
            content: params[i + 5],
            model: params[i + 6],
            status: params[i + 7],
            metadata: params[i + 8],
            created_at: params[i + 9],
            updated_at: params[i + 10],
          });
        }
        return { rows: [], rowCount: params.length / 11 };
      }

      if (sql.startsWith("insert into chat_history_operations")) {
        const [operationId, tenantId, userId, sessionId, payloadHash, createdAt] = params;
        operations.set(String(operationId), {
          operation_id: operationId,
          tenant_id: tenantId,
          user_id: userId,
          session_id: sessionId,
          payload_hash: payloadHash,
          created_at: createdAt,
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from chat_messages") && sql.includes("count(")) {
        const [sessionId, tenantId, userId] = params as string[];
        const rows = [...messages.values()].filter(
          (row) =>
            row.session_id === sessionId &&
            row.tenant_id === tenantId &&
            row.user_id === userId,
        );
        const last = rows.reduce<Date | null>((max, row) => {
          const at = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
          if (!max || at > max) return at;
          return max;
        }, null);
        return {
          rows: [{ message_count: rows.length, last_message_at: last }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("update chat_sessions set title")) {
        const [title, messageCount, lastMessageAt, updatedAt, id, tenantId, userId] = params;
        const row = sessions.get(String(id));
        if (!row || row.tenant_id !== tenantId || row.user_id !== userId) {
          return { rows: [], rowCount: 0 };
        }
        row.title = title;
        row.message_count = messageCount;
        row.last_message_at = lastMessageAt;
        row.updated_at = updatedAt;
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`unhandled sql in fake client: ${statement}`);
    },
    async transaction(callback) {
      return callback(client);
    },
    close() {},
  };
  return client;
}

function seedSession(client: ReturnType<typeof createFakeClient>, sessionId: string) {
  client.sessions.set(sessionId, {
    id: sessionId,
    tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
    user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
    title: "New chat",
    active_model: null,
    message_count: 0,
    last_message_at: null,
    deleted_at: null,
    created_at: new Date("2026-07-30T00:00:00.000Z"),
    updated_at: new Date("2026-07-30T00:00:00.000Z"),
  });
}

describe.each(["postgresql", "mysql"] as const)("append idempotency (%s)", (dialect) => {
  it("same operation_id inserts once and keeps COUNT correct (AC-2)", async () => {
    const client = createFakeClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const sessionId = ulid();
    seedSession(client, sessionId);
    const userId = ulid();
    const assistantId = ulid();
    const operationId = ulid();
    const payloadHash = "a".repeat(64);
    const messages = [
      {
        id: userId,
        session_id: sessionId,
        tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
        user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
        role: "user" as const,
        content: "hi",
        created_at: "2026-07-30T00:00:00.000Z",
      },
      {
        id: assistantId,
        session_id: sessionId,
        tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
        user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
        role: "assistant" as const,
        content: "hello",
        created_at: "2026-07-30T00:00:01.000Z",
      },
    ];

    await store.appendChatMessages(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      sessionId,
      messages,
      { operationId, payloadHash },
    );
    await store.appendChatMessages(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      sessionId,
      messages,
      { operationId, payloadHash },
    );

    expect(client.messages.size).toBe(2);
    expect(client.operations.size).toBe(1);
    expect(client.sessions.get(sessionId)?.message_count).toBe(2);
  });

  it("same message id same payload replays 200; different content 409 (AC-3)", async () => {
    const client = createFakeClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const sessionId = ulid();
    seedSession(client, sessionId);
    const messageId = ulid();
    const base = {
      id: messageId,
      session_id: sessionId,
      tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
      user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
      role: "user" as const,
      content: "same",
      created_at: "2026-07-30T00:00:00.000Z",
    };
    await store.appendChatMessages(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      sessionId,
      [base],
    );
    await store.appendChatMessages(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      sessionId,
      [base],
    );
    expect(client.messages.size).toBe(1);

    await expect(
      store.appendChatMessages(
        { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
        sessionId,
        [{ ...base, content: "different" }],
      ),
    ).rejects.toBeInstanceOf(ChatHistoryConflictError);
  });

  it("rejects invalid message id (AC-4)", async () => {
    const client = createFakeClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const sessionId = ulid();
    seedSession(client, sessionId);
    await expect(
      store.appendChatMessages(
        { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
        sessionId,
        [
          {
            id: "not-a-ulid",
            session_id: sessionId,
            tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
            user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
            role: "user",
            content: "x",
            created_at: "2026-07-30T00:00:00.000Z",
          },
        ],
      ),
    ).rejects.toThrow(/valid ULID/);
    expect(client.messages.size).toBe(0);
  });

  it("same operation_id different hash → conflict", async () => {
    const client = createFakeClient();
    const store = new SqlChatHistoryStore(dialect, client);
    const sessionId = ulid();
    seedSession(client, sessionId);
    const operationId = ulid();
    const message = {
      id: ulid(),
      session_id: sessionId,
      tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
      user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
      role: "user" as const,
      content: "x",
      created_at: "2026-07-30T00:00:00.000Z",
    };
    await store.appendChatMessages(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
      sessionId,
      [message],
      { operationId, payloadHash: "a".repeat(64) },
    );
    await expect(
      store.appendChatMessages(
        { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" },
        sessionId,
        [{ ...message, content: "y" }],
        { operationId, payloadHash: "b".repeat(64) },
      ),
    ).rejects.toBeInstanceOf(ChatHistoryConflictError);
  });
});
