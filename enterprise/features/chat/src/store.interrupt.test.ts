import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@agenticx/core-api";
import { MockChatClient } from "@agenticx/sdk-ts";

const { appendMessages } = vi.hoisted(() => ({
  appendMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessages,
    replaceMessages: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    patchSession: vi.fn(),
    deleteSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

import { useChatStore } from "./store";

function session(id: string): ChatSession {
  const ts = "2026-05-03T00:00:00.000Z";
  return {
    id,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title: "Test session",
    message_count: 0,
    created_at: ts,
    updated_at: ts,
  };
}

describe("chat store stream interrupt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      sessions: [session("A")],
      activeSessionId: "A",
      messages: [],
      hydrated: true,
      historyLoading: false,
      historyError: null,
      sessionMessagesLoading: false,
      status: "idle",
      activeModel: "test-model",
      activeRequestId: null,
      streamingSessionId: null,
      errorMessage: null,
      sessionTokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        lastInputTokens: 0,
        lastOutputTokens: 0,
        lastUpdatedAt: null,
      },
      sessionTokensBySessionId: {},
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("retains partial assistant content and persists on user cancel", async () => {
    const client = new MockChatClient();
    const sendPromise = useChatStore.getState().sendMessage(client, { content: "hello" });

    await vi.waitFor(() => {
      expect(useChatStore.getState().status).toBe("streaming");
    });

    await vi.waitFor(() => {
      const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant");
      expect((assistant?.content.length ?? 0)).toBeGreaterThan(0);
    });

    const partialBeforeCancel =
      useChatStore.getState().messages.find((message) => message.role === "assistant")?.content ?? "";

    await useChatStore.getState().cancel(client);
    await sendPromise;

    const state = useChatStore.getState();
    const assistant = state.messages.find((message) => message.role === "assistant");

    expect(state.status).toBe("idle");
    expect(state.errorMessage).toBeNull();
    expect(assistant?.content).toBe(partialBeforeCancel);
    expect(assistant?.content).not.toContain("request cancelled");
    expect(assistant?.content.length).toBeGreaterThan(0);
    expect(appendMessages).toHaveBeenCalledTimes(1);
    expect(appendMessages).toHaveBeenCalledWith(
      "A",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "hello" }),
        expect.objectContaining({ role: "assistant", content: partialBeforeCancel }),
      ]),
    );
  });
});
