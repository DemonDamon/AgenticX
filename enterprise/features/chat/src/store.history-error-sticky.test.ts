import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@agenticx/core-api";

const { getMessages } = vi.hoisted(() => ({
  getMessages: vi.fn(),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages,
    appendMessages: vi.fn().mockResolvedValue(undefined),
    replaceMessages: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    patchSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    pinSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

import { useChatStore } from "./store";

function session(id: string, title: string): ChatSession {
  const ts = "2026-05-03T00:00:00.000Z";
  return {
    id,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title,
    message_count: 0,
    created_at: ts,
    updated_at: ts,
  };
}

describe("global historyError does not stick after connectivity recovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      sessions: [session("A", "chat A"), session("B", "chat B")],
      activeSessionId: "A",
      messages: [],
      hydrated: true,
      historyLoading: false,
      // Simulate a prior transient "Failed to fetch" that already set the global banner.
      historyError: "无法连接门户服务（网络中断或开发服务未响应）。历史同步失败。",
      sessionMessagesLoading: false,
      status: "idle",
      activeModel: "test-model",
      activeRequestId: null,
      streamingSessionId: null,
      streamStateBySessionId: {},
      errorMessage: null,
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("clears historyError on a successful switchSession, without needing a page refresh", async () => {
    getMessages.mockResolvedValueOnce([]);

    await useChatStore.getState().switchSession("B");

    expect(useChatStore.getState().historyError).toBeNull();
    expect(useChatStore.getState().activeSessionId).toBe("B");
  });

  it("keeps historyError set if the switch itself still fails (no false recovery)", async () => {
    getMessages.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await useChatStore.getState().switchSession("B");

    expect(useChatStore.getState().historyError).not.toBeNull();
  });
});
