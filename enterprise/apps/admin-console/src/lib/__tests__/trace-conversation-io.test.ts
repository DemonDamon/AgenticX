import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clipText,
  pickTurnMessages,
  splitReasoning,
  TRACE_IO_EXPAND_CHARS,
  TRACE_IO_PREVIEW_CHARS,
} from "../trace-conversation-io";

const resolveDatabaseConfigMock = vi.fn();
const getIamDbMock = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  resolveDatabaseConfig: (...args: unknown[]) => resolveDatabaseConfigMock(...args),
  getIamDb: (...args: unknown[]) => getIamDbMock(...args),
}));

vi.mock("../db-stores/mysql/database", () => ({
  getAdminMysqlDb: vi.fn(),
}));

describe("trace-conversation-io helpers", () => {
  it("clips long text with truncated flag", () => {
    const long = "a".repeat(TRACE_IO_PREVIEW_CHARS + 10);
    const clipped = clipText(long, TRACE_IO_PREVIEW_CHARS);
    expect(clipped.truncated).toBe(true);
    expect(clipped.length).toBe(long.length);
    expect(clipped.text.endsWith("…")).toBe(true);
    expect(clipped.text.length).toBe(TRACE_IO_PREVIEW_CHARS + 1);
  });

  it("splits think blocks from assistant content", () => {
    const raw = "<think>plan step</think>\nfinal answer";
    const { display, reasoning } = splitReasoning(raw);
    expect(reasoning).toContain("plan step");
    expect(display).toContain("final answer");
    expect(display).not.toContain("plan step");
  });

  it("pickTurnMessages keeps user→tool→assistant window", () => {
    const rows = [
      { role: "assistant", id: "a2" },
      { role: "tool", id: "t1" },
      { role: "user", id: "u1" },
      { role: "assistant", id: "a1" },
    ];
    expect(pickTurnMessages(rows).map((r) => r.id)).toEqual(["u1", "t1", "a2"]);
  });
});

describe("getSessionConversation", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveDatabaseConfigMock.mockReset();
    getIamDbMock.mockReset();
  });

  function makeRow(i: number, content = `msg-${i}`) {
    return {
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content,
      model: i % 2 === 0 ? null : "test/model",
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)),
      metadata: null,
    };
  }

  function mockSelectRows(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    getIamDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });
    resolveDatabaseConfigMock.mockReturnValue({ dialect: "postgresql" });
  }

  it("returns 40 messages with has_more when 41 rows exist", async () => {
    const rows = Array.from({ length: 41 }, (_, i) => makeRow(40 - i));
    mockSelectRows(rows);

    const { getSessionConversation, SESSION_CONVERSATION_PAGE_SIZE } = await import(
      "../trace-conversation-io"
    );
    const result = await getSessionConversation("t1", "sess-1");
    expect(SESSION_CONVERSATION_PAGE_SIZE).toBe(40);
    expect(result.messages).toHaveLength(40);
    expect(result.has_more).toBe(true);
    expect(result.next_before).toBe(result.messages[0]?.created_at);
    // chronological: earliest first
    expect(result.messages[0]?.id).toBe("m1");
    expect(result.messages[39]?.id).toBe("m40");
  });

  it("returns chronological order for a short session", async () => {
    mockSelectRows([makeRow(2), makeRow(1), makeRow(0)]);
    const { getSessionConversation } = await import("../trace-conversation-io");
    const result = await getSessionConversation("t1", "sess-1");
    expect(result.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(result.has_more).toBe(false);
    expect(result.empty).toBe(false);
  });

  it("clips at preview / expand limits", async () => {
    const long = "x".repeat(TRACE_IO_EXPAND_CHARS + 50);
    mockSelectRows([makeRow(0, long)]);
    const { getSessionConversation } = await import("../trace-conversation-io");

    const preview = await getSessionConversation("t1", "sess-1");
    expect(preview.messages[0]?.content.truncated).toBe(true);
    expect(preview.messages[0]?.content.text.length).toBe(TRACE_IO_PREVIEW_CHARS + 1);

    mockSelectRows([makeRow(0, long)]);
    const expanded = await getSessionConversation("t1", "sess-1", { expand: true });
    expect(expanded.messages[0]?.content.truncated).toBe(true);
    expect(expanded.messages[0]?.content.text.length).toBe(TRACE_IO_EXPAND_CHARS + 1);
  });

  it("returns empty for sessions with no messages", async () => {
    mockSelectRows([]);
    const { getSessionConversation } = await import("../trace-conversation-io");
    const result = await getSessionConversation("t1", "sess-empty");
    expect(result).toEqual({
      session_id: "sess-empty",
      messages: [],
      has_more: false,
      empty: true,
    });
  });
});
