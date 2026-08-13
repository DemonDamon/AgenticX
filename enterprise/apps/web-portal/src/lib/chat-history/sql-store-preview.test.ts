import { describe, expect, it, vi } from "vitest";
import {
  assistantHistoryPreview,
  SqlChatHistoryStore,
  type SqlClient,
  type SqlDialect,
  type SqlResult,
} from "./sql-store";

function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "session-a",
    tenant_id: "tenant-a",
    user_id: "user-a",
    title: "历史会话",
    message_count: 2,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:01.000Z",
    ...overrides,
  };
}

function createClient(rows: Record<string, unknown>[]) {
  const query = vi.fn(
    async (_statement: string, _params?: unknown[]): Promise<SqlResult> => ({
      rows,
      rowCount: rows.length,
    }),
  );
  const client: SqlClient = {
    query,
    async transaction<T>(callback: (tx: SqlClient) => Promise<T>): Promise<T> {
      return callback(client);
    },
    close: vi.fn(),
  };
  return { client, query };
}

describe("history session previews", () => {
  it("starts assistant previews at visible answer text", () => {
    expect(assistantHistoryPreview("<think>内部分析</think>\n## 正文答案")).toBe("## 正文答案");
    expect(
      assistantHistoryPreview("<think>第一段</think>正文一<think>第二段</think>正文二"),
    ).toBe("正文一 正文二");
    expect(assistantHistoryPreview("遗留的内部分析</think>最终答案")).toBe("最终答案");
  });

  it("does not expose an unfinished reasoning block", () => {
    expect(assistantHistoryPreview("<think>仍在推理，没有正文")).toBeUndefined();
  });

  it.each(["postgresql", "mysql"] as const)(
    "maps the %s assistant preview and keeps user fallback text intact",
    async (dialect: SqlDialect) => {
      const { client, query } = createClient([
        sessionRow({
          assistant_preview_text: "<think>内部分析</think>正文开始",
          user_preview_text: "用户问题",
        }),
        sessionRow({
          id: "session-b",
          assistant_preview_text: null,
          user_preview_text: "用户写下的 <think> 示例",
        }),
      ]);
      const store = new SqlChatHistoryStore(dialect, client);

      const sessions = await store.listChatSessions({ tenantId: "tenant-a", userId: "user-a" });

      expect(sessions.map((session) => session.preview)).toEqual([
        "正文开始",
        "用户写下的 <think> 示例",
      ]);
      const statement = String(query.mock.calls[0]?.[0]);
      expect(statement).toContain("assistant_preview_text");
      expect(statement).toContain("user_preview_text");
      expect(statement).toContain("reverse(lower(m.content))");
    },
  );
});
