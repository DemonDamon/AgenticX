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

import { useChatStore } from "./store";

const TRACE_ID = "01J0000000000000000000000A";
const NEXT_TRACE_ID = "01J0000000000000000000000B";

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

class TraceCapturingClient implements ChatClient {
  constructor(private readonly traceId = TRACE_ID) {}

  async sendMessage(_req: ChatRequest): Promise<SendMessageResult> {
    return { requestId: "r1", traceId: this.traceId };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId, done: false, delta: "ok" };
    yield { requestId, done: true };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

describe("chat store attaches trace_id to assistant messages", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [session("A", "trace")],
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
      lastWebSearchBySessionId: {},
      lastDeepResearchBySessionId: {},
    });
  });

  it("stores sendMessage traceId on the assistant message", async () => {
    const client = new TraceCapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "hello" });
    const state = useChatStore.getState();
    const user = state.messages.find((m) => m.role === "user");
    const assistant = state.messages.find((m) => m.role === "assistant");
    expect(assistant?.trace_id).toBe(TRACE_ID);
    expect(user && state.responseVersionsByUserMessageId[user.id]?.versions[0]?.trace_id).toBe(
      TRACE_ID,
    );
  });

  it("updates traceId for regenerated assistant versions", async () => {
    await useChatStore.getState().sendMessage(new TraceCapturingClient(), { content: "hello" });
    const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();

    await useChatStore
      .getState()
      .regenerateAssistantResponse(new TraceCapturingClient(NEXT_TRACE_ID), assistant!.id);

    const state = useChatStore.getState();
    const user = state.messages.find((m) => m.role === "user");
    const regenerated = state.messages.find((m) => m.role === "assistant");
    const versions = user ? state.responseVersionsByUserMessageId[user.id] : undefined;
    expect(regenerated?.trace_id).toBe(NEXT_TRACE_ID);
    expect(versions?.versions[versions.activeIndex]?.trace_id).toBe(NEXT_TRACE_ID);
  });

  it("updates traceId after editing and resending a user message", async () => {
    await useChatStore.getState().sendMessage(new TraceCapturingClient(), { content: "hello" });
    const user = useChatStore.getState().messages.find((m) => m.role === "user");
    expect(user).toBeDefined();

    await useChatStore.getState().editUserMessageAndResend(
      new TraceCapturingClient(NEXT_TRACE_ID),
      { messageId: user!.id, content: "edited" },
    );

    const state = useChatStore.getState();
    const editedUser = state.messages.find((m) => m.role === "user");
    const assistant = state.messages.find((m) => m.role === "assistant");
    const versions = editedUser
      ? state.responseVersionsByUserMessageId[editedUser.id]
      : undefined;
    expect(assistant?.trace_id).toBe(NEXT_TRACE_ID);
    expect(versions?.versions[versions.activeIndex]?.trace_id).toBe(NEXT_TRACE_ID);
  });
});
