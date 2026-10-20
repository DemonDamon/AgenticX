import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { ulid } from "ulid";
import { SqlChatHistoryStore, type SqlClient, type SqlResult } from "./sql-store";

type Row = Record<string, unknown>;

const tenantId = "01J00000000000000000000001";
const userId = "01J00000000000000000000002";

function createFakeClient(feedbackTablePresent = true): SqlClient & {
  sessions: Map<string, Row>;
  messages: Map<string, Row>;
  feedback: Map<string, Row>;
  queries: string[];
} {
  const sessions = new Map<string, Row>();
  const messages = new Map<string, Row>();
  const feedback = new Map<string, Row>();
  const queries: string[] = [];

  const client: SqlClient & {
    messages: Map<string, Row>;
    feedback: Map<string, Row>;
    queries: string[];
    sessions: Map<string, Row>;
  } = {
    sessions,
    messages,
    feedback,
    queries,
    async query(statement: string, params: unknown[] = []): Promise<SqlResult> {
      const sql = statement.replace(/\s+/g, " ").trim().toLowerCase();
      queries.push(sql);

      if (sql.startsWith("select * from chat_sessions")) {
        const [id, tenant, user] = params;
        const row = sessions.get(String(id));
        if (row && row.tenant_id === tenant && row.user_id === user && row.deleted_at == null) {
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("select") && sql.includes("from chat_message_feedback")) {
        const [tenant, user, session] = params;
        const rows = [...feedback.values()].filter(
          (row) =>
            row.tenant_id === tenant &&
            row.user_id === user &&
            row.session_id === session &&
            row.source === "web",
        );
        return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
      }

      if (sql.startsWith("delete from chat_messages")) {
        const [session, tenant, user] = params;
        const removed = new Set<string>();
        for (const [id, row] of messages) {
          if (row.session_id === session && row.tenant_id === tenant && row.user_id === user) {
            removed.add(id);
            messages.delete(id);
          }
        }
        for (const [id, row] of feedback) {
          if (removed.has(String(row.message_id))) feedback.delete(id);
        }
        return { rows: [], rowCount: removed.size };
      }

      if (sql.startsWith("insert into chat_messages")) {
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

      if (sql.startsWith("insert into chat_message_feedback")) {
        const width = 16;
        for (let i = 0; i + width <= params.length; i += width) {
          const messageId = String(params[i + 5]);
          if (!messages.has(messageId)) {
            throw new Error(`feedback message_id ${messageId} is not in chat_messages`);
          }
          const id = String(params[i]);
          feedback.set(id, {
            id,
            tenant_id: params[i + 1],
            user_id: params[i + 2],
            department_id: params[i + 3],
            session_id: params[i + 4],
            message_id: params[i + 5],
            value: params[i + 6],
            source: params[i + 7],
            external_session_id: params[i + 8],
            external_message_id: params[i + 9],
            trace_id: params[i + 10],
            provider: params[i + 11],
            model: params[i + 12],
            answer_excerpt: params[i + 13],
            created_at: params[i + 14],
            updated_at: params[i + 15],
          });
        }
        return { rows: [], rowCount: params.length / width };
      }

      if (sql.includes("to_regclass('chat_message_feedback')") || sql.includes("from information_schema.tables")) {
        return { rows: [{ present: feedbackTablePresent ? (sql.includes("to_regclass") ? true : 1) : sql.includes("to_regclass") ? false : 0 }], rowCount: 1 };
      }

      if (sql.startsWith("update chat_sessions set title")) {
        const id = String(params[4]);
        const row = sessions.get(id);
        if (!row) return { rows: [], rowCount: 0 };
        row.title = params[0];
        row.message_count = params[1];
        row.last_message_at = params[2];
        row.updated_at = params[3];
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

function message(input: {
  id: string;
  sessionId: string;
  role: ChatMessage["role"];
  content: string;
  createdAt: string;
}): ChatMessage {
  return {
    id: input.id,
    session_id: input.sessionId,
    tenant_id: tenantId,
    user_id: userId,
    role: input.role,
    content: input.content,
    created_at: input.createdAt,
  };
}

describe.each(["postgresql", "mysql"] as const)("replaceAll preserves web feedback (%s)", (dialect) => {
  const ctx = { tenantId, userId };

  function seed() {
    const client = createFakeClient();
    const sessionId = ulid();
    const userMessageId = ulid();
    const assistantA = ulid();
    const assistantB = ulid();
    const voteA = ulid();
    const voteB = ulid();
    const createdA = new Date("2026-08-01T00:00:00.000Z");
    const updatedA = new Date("2026-08-01T00:05:00.000Z");
    const createdB = new Date("2026-08-01T00:10:00.000Z");
    const updatedB = new Date("2026-08-01T00:15:00.000Z");
    client.sessions.set(sessionId, {
      id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      title: "电池讨论",
      message_count: 3,
      last_message_at: createdB,
      deleted_at: null,
      created_at: createdA,
      updated_at: updatedA,
    });
    for (const row of [
      message({
        id: userMessageId,
        sessionId,
        role: "user",
        content: "比较电池寿命",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      message({
        id: assistantA,
        sessionId,
        role: "assistant",
        content: "回答 A",
        createdAt: "2026-08-01T00:00:01.000Z",
      }),
      message({
        id: assistantB,
        sessionId,
        role: "assistant",
        content: "回答 B",
        createdAt: "2026-08-01T00:00:02.000Z",
      }),
    ]) {
      client.messages.set(row.id, { ...row, status: "complete" });
    }
    client.feedback.set(voteA, {
      id: voteA,
      tenant_id: tenantId,
      user_id: userId,
      department_id: "01J00000000000000000000003",
      session_id: sessionId,
      message_id: assistantA,
      value: "like",
      source: "web",
      external_session_id: null,
      external_message_id: null,
      trace_id: "trace-a",
      provider: "openai",
      model: "gpt-4o-mini",
      answer_excerpt: "回答 A",
      created_at: createdA,
      updated_at: updatedA,
    });
    client.feedback.set(voteB, {
      id: voteB,
      tenant_id: tenantId,
      user_id: userId,
      department_id: "01J00000000000000000000003",
      session_id: sessionId,
      message_id: assistantB,
      value: "dislike",
      source: "web",
      external_session_id: null,
      external_message_id: null,
      trace_id: "trace-b",
      provider: "openai",
      model: "gpt-4o-mini",
      answer_excerpt: "回答 B",
      created_at: createdB,
      updated_at: updatedB,
    });
    return { client, sessionId, userMessageId, assistantA, assistantB, voteA, voteB, createdA, updatedA, createdB, updatedB };
  }

  it("keeps both votes when replaceAll keeps both assistant messages", async () => {
    const seeded = seed();
    const store = new SqlChatHistoryStore(dialect, seeded.client);
    await store.replaceAllChatSessionMessages(ctx, seeded.sessionId, [
      message({
        id: seeded.userMessageId,
        sessionId: seeded.sessionId,
        role: "user",
        content: "比较电池寿命（已编辑）",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      message({
        id: seeded.assistantA,
        sessionId: seeded.sessionId,
        role: "assistant",
        content: "回答 A 修订",
        createdAt: "2026-08-01T00:00:01.000Z",
      }),
      message({
        id: seeded.assistantB,
        sessionId: seeded.sessionId,
        role: "assistant",
        content: "回答 B 修订",
        createdAt: "2026-08-01T00:00:02.000Z",
      }),
    ]);

    expect(seeded.client.messages.get(seeded.assistantA)?.content).toBe("回答 A 修订");
    expect(seeded.client.feedback.size).toBe(2);
    expect(seeded.client.feedback.get(seeded.voteA)).toMatchObject({
      id: seeded.voteA,
      message_id: seeded.assistantA,
      value: "like",
      source: "web",
      trace_id: "trace-a",
      provider: "openai",
      model: "gpt-4o-mini",
      answer_excerpt: "回答 A",
      created_at: seeded.createdA,
      updated_at: seeded.updatedA,
    });
    expect(seeded.client.feedback.get(seeded.voteB)).toMatchObject({
      id: seeded.voteB,
      message_id: seeded.assistantB,
      value: "dislike",
      created_at: seeded.createdB,
      updated_at: seeded.updatedB,
    });
    const selectAt = seeded.client.queries.findIndex((sql) => sql.includes("from chat_message_feedback") && sql.startsWith("select"));
    const deleteAt = seeded.client.queries.findIndex((sql) => sql.startsWith("delete from chat_messages"));
    expect(selectAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeLessThan(deleteAt);
  });

  it("drops only the vote whose assistant message was removed", async () => {
    const seeded = seed();
    const store = new SqlChatHistoryStore(dialect, seeded.client);
    await store.replaceAllChatSessionMessages(ctx, seeded.sessionId, [
      message({
        id: seeded.userMessageId,
        sessionId: seeded.sessionId,
        role: "user",
        content: "比较电池寿命",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      message({
        id: seeded.assistantA,
        sessionId: seeded.sessionId,
        role: "assistant",
        content: "回答 A",
        createdAt: "2026-08-01T00:00:01.000Z",
      }),
    ]);

    expect(seeded.client.messages.has(seeded.assistantB)).toBe(false);
    expect([...seeded.client.feedback.keys()]).toEqual([seeded.voteA]);
    expect(seeded.client.feedback.get(seeded.voteA)).toMatchObject({
      id: seeded.voteA,
      message_id: seeded.assistantA,
      value: "like",
      created_at: seeded.createdA,
      updated_at: seeded.updatedA,
    });
  });

  it("still replaces messages when the feedback table has not been migrated", async () => {
    const client = createFakeClient(false);
    const sessionId = ulid();
    const assistantId = ulid();
    client.sessions.set(sessionId, {
      id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      title: "未迁移",
      message_count: 1,
      last_message_at: new Date("2026-08-01T00:00:00.000Z"),
      deleted_at: null,
      created_at: new Date("2026-08-01T00:00:00.000Z"),
      updated_at: new Date("2026-08-01T00:00:00.000Z"),
    });
    const store = new SqlChatHistoryStore(dialect, client);
    await store.replaceAllChatSessionMessages(ctx, sessionId, [
      message({ id: assistantId, sessionId, role: "assistant", content: "新回答", createdAt: "2026-08-01T00:00:01.000Z" }),
    ]);
    expect(client.messages.get(assistantId)?.content).toBe("新回答");
    expect(client.queries.some((sql) => sql.includes("from chat_message_feedback"))).toBe(false);
  });
});
