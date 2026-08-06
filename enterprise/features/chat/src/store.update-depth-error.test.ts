import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
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

import { STREAM_UPDATE_DEPTH_ERROR, useChatStore } from "./store";

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

class UpdateDepthClient implements ChatClient {
  async sendMessage(_req: ChatRequest): Promise<SendMessageResult> {
    return { requestId: "req-1" };
  }

  async *stream(_requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId: "req-1", done: false, delta: "partial " };
    throw new Error(
      "Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.",
    );
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

describe("stream update-depth error mapping", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [session("A", "chat")],
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
      streamStateBySessionId: {},
      errorMessage: null,
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("maps Maximum update depth exceeded to STREAM_UPDATE_DEPTH_ERROR and keeps streamed content", async () => {
    const client = new UpdateDepthClient();
    await useChatStore.getState().sendMessage(client, { content: "hello" });
    const state = useChatStore.getState();
    expect(state.errorMessage).toBe(STREAM_UPDATE_DEPTH_ERROR);
    const assistant = state.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("partial");
  });
});
