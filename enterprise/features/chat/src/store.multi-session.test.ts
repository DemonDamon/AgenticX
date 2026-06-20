import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

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
import { isSessionStreaming } from "./utils/session-stream-state";

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

/** Mock client whose stream hangs until cancel is called. Cancel resolves wait immediately. */
class HangingStreamClient implements ChatClient {
  private readonly pending = new Map<
    string,
    { resolveWait: () => void; waitPromise: Promise<void>; cancelled: boolean }
  >();
  private seq = 0;

  async sendMessage(_req: ChatRequest): Promise<SendMessageResult> {
    this.seq += 1;
    const requestId = `req-${this.seq}`;
    let resolveWait!: () => void;
    const waitPromise = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
    this.pending.set(requestId, { resolveWait, waitPromise, cancelled: false });
    return { requestId };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    const entry = this.pending.get(requestId);
    if (!entry) {
      yield { requestId, done: true, error: { code: "NOT_FOUND", message: "missing" } };
      return;
    }
    yield { requestId, done: false, delta: "partial" };
    await entry.waitPromise;
    this.pending.delete(requestId);
    if (entry.cancelled) {
      yield { requestId, done: true, cancelled: true };
      return;
    }
    yield { requestId, done: true };
  }

  async cancel(requestId: string): Promise<void> {
    const entry = this.pending.get(requestId);
    if (entry) {
      entry.cancelled = true;
      entry.resolveWait();
    }
  }
}

describe("chat store multi-session stream state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      sessions: [session("A", "verify"), session("B", "你好")],
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
    });
  });

  async function settleAllStreams(client: HangingStreamClient, ...promises: Promise<unknown>[]) {
    const state = useChatStore.getState();
    for (const sid of Object.keys(state.streamStateBySessionId)) {
      const reqId = state.streamStateBySessionId[sid]?.activeRequestId;
      if (reqId) await client.cancel(reqId);
    }
    await Promise.all(promises);
  }

  it("shows idle on session B while session A is streaming", async () => {
    const client = new HangingStreamClient();
    const sendA = useChatStore.getState().sendMessage(client, { content: "hello A" });

    await vi.waitFor(() => {
      expect(isSessionStreaming(useChatStore.getState(), "A")).toBe(true);
    });

    await useChatStore.getState().switchSession("B");

    const state = useChatStore.getState();
    expect(state.activeSessionId).toBe("B");
    expect(state.status).toBe("idle");
    expect(isSessionStreaming(state, "B")).toBe(false);
    expect(isSessionStreaming(state, "A")).toBe(true);
    expect(state.streamStateBySessionId.A?.status).toBeDefined();

    await settleAllStreams(client, sendA);
  });

  it("does not enqueue send on idle session B while session A streams", async () => {
    const client = new HangingStreamClient();
    const sendA = useChatStore.getState().sendMessage(client, { content: "hello A" });

    await vi.waitFor(() => {
      expect(isSessionStreaming(useChatStore.getState(), "A")).toBe(true);
    });

    await useChatStore.getState().switchSession("B");

    const sendB = useChatStore.getState().sendMessage(client, { content: "继续" });

    await vi.waitFor(() => {
      expect(useChatStore.getState().pendingMessages).toHaveLength(0);
    });

    const state = useChatStore.getState();
    expect(isSessionStreaming(state, "B")).toBe(true);

    await settleAllStreams(client, sendA, sendB);
  });

  it("preserves streaming partial when switching away and back to session A", async () => {
    const client = new HangingStreamClient();
    const sendA = useChatStore.getState().sendMessage(client, { content: "hello A" });

    await vi.waitFor(() => {
      const a = useChatStore
        .getState()
        .messages.find((m) => m.session_id === "A" && m.role === "assistant");
      expect((a?.content.length ?? 0)).toBeGreaterThan(0);
    });

    const partialBeforeSwitch =
      useChatStore.getState().messages.find((m) => m.session_id === "A" && m.role === "assistant")
        ?.content ?? "";
    expect(partialBeforeSwitch.length).toBeGreaterThan(0);

    await useChatStore.getState().switchSession("B");
    await useChatStore.getState().switchSession("A");

    const after = useChatStore.getState();
    const assistantA = after.messages.find((m) => m.session_id === "A" && m.role === "assistant");
    expect(assistantA?.content).toBe(partialBeforeSwitch);
    expect(isSessionStreaming(after, "A")).toBe(true);

    await settleAllStreams(client, sendA);
  });
});
