import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@agenticx/core-api";
import type { ChatClient, ChatChunk, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";

const { appendMessages } = vi.hoisted(() => ({
  appendMessages: vi.fn(),
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
    deleteSessions: vi.fn(),
    pinSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

import { useChatStore } from "./store";

function session(id: string): ChatSession {
  const timestamp = "2026-05-03T00:00:00.000Z";
  return {
    id,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title: "Test session",
    message_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

class ImmediateStreamClient implements ChatClient {
  async sendMessage(_request: ChatRequest): Promise<SendMessageResult> {
    return { requestId: crypto.randomUUID() };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId, done: false, delta: "answer" };
    yield { requestId, done: true };
  }

  async cancel(): Promise<void> {}
}

describe("chat history append persistence", () => {
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
      streamStateBySessionId: {},
      errorMessage: null,
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("serializes direct history appends for consecutive completed turns in one session", async () => {
    let releaseFirstAppend: (() => void) | undefined;
    appendMessages
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstAppend = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const client = new ImmediateStreamClient();

    const firstTurn = useChatStore.getState().sendMessage(client, { content: "first" });
    await vi.waitFor(() => expect(appendMessages).toHaveBeenCalledTimes(1));

    const secondTurn = useChatStore.getState().sendMessage(client, { content: "second" });
    await vi.waitFor(() =>
      expect(useChatStore.getState().messages.some((message) => message.role === "user" && message.content === "second")).toBe(
        true,
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(appendMessages).toHaveBeenCalledTimes(1);

    releaseFirstAppend?.();
    await firstTurn;
    await secondTurn;

    expect(appendMessages).toHaveBeenCalledTimes(2);
  });
});
