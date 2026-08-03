import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { SqlChatHistoryStore, type SqlClient, type SqlResult } from "./sql-store";

const tenantId = "01TENANTAAAAAAAAAAAAAAAAAA";
const userId = "01USERAAAAAAAAAAAAAAAAAAAA";

function createShareClient() {
  const sessionId = ulid();
  const userMessageId = ulid();
  const assistantMessageId = ulid();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const session = {
    id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    title: "Share me",
    message_count: 2,
    deleted_at: null,
    created_at: new Date("2026-08-03T00:00:00.000Z"),
    updated_at: new Date("2026-08-03T00:00:00.000Z"),
  };
  const messages = [
    {
      id: userMessageId,
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content: "hello",
      model: null,
      metadata: null,
      created_at: new Date("2026-08-03T00:00:00.000Z"),
    },
    {
      id: assistantMessageId,
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "world",
      model: "mock-model",
      metadata: null,
      created_at: new Date("2026-08-03T00:00:01.000Z"),
    },
  ];
  let token = "";
  let storedMessages = "";

  const client: SqlClient = {
    async query(statement: string, params: unknown[] = []): Promise<SqlResult> {
      const sql = statement.replace(/\s+/g, " ").trim().toLowerCase();
      calls.push({ sql, params });
      if (sql.startsWith("select * from chat_sessions")) return { rows: [session], rowCount: 1 };
      if (sql.startsWith("select * from chat_messages") && sql.includes("session_id")) {
        return { rows: messages, rowCount: messages.length };
      }
      if (sql.startsWith("insert into chat_share_snapshots")) {
        token = String(params[0]);
        storedMessages = String(params[5]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("select sh.token")) {
        return {
          rows: [{
            token,
            session_id: sessionId,
            title: session.title,
            messages: storedMessages,
            created_at: new Date("2026-08-03T00:00:02.000Z"),
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("update chat_sessions")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("update chat_share_snapshots")) return { rows: [], rowCount: 1 };
      throw new Error(`unhandled sql: ${statement}`);
    },
    async transaction<T>(callback: (client: SqlClient) => Promise<T>): Promise<T> {
      return callback(this);
    },
    close() {},
  };

  return { client, sessionId, userMessageId, assistantMessageId, calls, getToken: () => token };
}

describe.each(["postgresql", "mysql"] as const)("chat sharing (%s)", (dialect) => {
  it("creates an immutable complete-turn snapshot and reads it back", async () => {
    const fixture = createShareClient();
    const store = new SqlChatHistoryStore(dialect, fixture.client);
    const snapshot = await store.createChatShareSnapshot(
      { tenantId, userId },
      fixture.sessionId,
      [fixture.assistantMessageId],
    );

    expect(snapshot.token).toHaveLength(32);
    expect(snapshot.messages.map((message) => message.content)).toEqual(["hello", "world"]);
    expect(JSON.parse(fixture.getToken() ? String(fixture.calls.find((call) => call.sql.startsWith("insert into chat_share_snapshots"))?.params[5]) : "[]")).toHaveLength(2);

    const loaded = await store.getChatShareSnapshot(snapshot.token, tenantId);
    expect(loaded?.messages.map((message) => message.content)).toEqual(["hello", "world"]);
    expect(fixture.calls.some((call) => call.sql.startsWith("select sh.token") && call.params[1] === tenantId)).toBe(true);
  });

  it("revokes snapshots when the source conversation is deleted", async () => {
    const fixture = createShareClient();
    const store = new SqlChatHistoryStore(dialect, fixture.client);
    const deleted = await store.softDeleteChatSessions({ tenantId, userId }, [fixture.sessionId]);

    expect(deleted).toBe(1);
    expect(fixture.calls.some((call) => call.sql.startsWith("update chat_share_snapshots"))).toBe(true);
  });
});
