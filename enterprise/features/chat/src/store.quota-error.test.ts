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

function session(): ChatSession {
  const ts = "2026-08-18T00:00:00.000Z";
  return {
    id: "A",
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title: "quota",
    message_count: 0,
    created_at: ts,
    updated_at: ts,
  };
}

class QuotaErrorClient implements ChatClient {
  async sendMessage(_request: ChatRequest): Promise<SendMessageResult> {
    return { requestId: "quota-request", traceId: "quota-trace" };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield {
      requestId,
      done: true,
      error: {
        code: "42901",
        message: "本周 Token 额度已用尽",
        kind: "token_week",
        period: "2026-W34",
        resetAt: "2026-08-24T00:00:00Z",
        used: 1_100,
        limit: 1_000,
      },
    };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

class SuccessClient implements ChatClient {
  async sendMessage(_request: ChatRequest): Promise<SendMessageResult> {
    return { requestId: "success-request", traceId: "success-trace" };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId, done: false, delta: "ok" };
    yield { requestId, done: true };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

class DeferredQuotaClient implements ChatClient {
  private releaseStream: (() => void) | null = null;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseStream = resolve;
  });

  release(): void {
    this.releaseStream?.();
  }

  async sendMessage(_request: ChatRequest): Promise<SendMessageResult> {
    return { requestId: "deferred-request", traceId: "deferred-trace" };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    await this.gate;
    yield {
      requestId,
      done: true,
      error: {
        code: "42901",
        message: "今日 Token 额度已用尽",
        kind: "token_day",
        resetAt: "2026-08-19T00:00:00Z",
      },
    };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

describe("structured enterprise quota errors", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [session()],
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
      quotaError: null,
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("stores the exact quota period and reset time", async () => {
    await useChatStore.getState().sendMessage(new QuotaErrorClient(), { content: "hello" });

    expect(useChatStore.getState().quotaError).toEqual({
      kind: "token_week",
      message: "本周 Token 额度已用尽",
      period: "2026-W34",
      resetAt: "2026-08-24T00:00:00Z",
      used: 1_100,
      limit: 1_000,
    });
    expect(
      useChatStore.getState().messages.find((message) => message.role === "assistant")?.content,
    ).toContain("本周 Token 额度已用尽");
    expect(
      useChatStore.getState().messages.find((message) => message.role === "assistant")?.content,
    ).not.toContain("联系管理员调整额度");
  });

  it("clears a previous quota error when the next turn starts", async () => {
    await useChatStore.getState().sendMessage(new QuotaErrorClient(), { content: "first" });
    expect(useChatStore.getState().quotaError?.kind).toBe("token_week");

    await useChatStore.getState().sendMessage(new SuccessClient(), { content: "second" });
    expect(useChatStore.getState().quotaError).toBeNull();
  });

  it("does not show a background session quota error in the active session", async () => {
    useChatStore.setState((state) => ({
      sessions: [
        ...state.sessions,
        { ...session(), id: "B", title: "active" },
      ],
    }));
    const client = new DeferredQuotaClient();
    const send = useChatStore.getState().sendMessage(client, { content: "background" });
    await vi.waitFor(() => {
      expect(useChatStore.getState().streamingSessionId).toBe("A");
    });

    await useChatStore.getState().switchSession("B");
    client.release();
    await send;

    const state = useChatStore.getState();
    expect(state.activeSessionId).toBe("B");
    expect(state.errorMessage).toBeNull();
    expect(state.quotaError).toBeNull();
    expect(
      state.messages.find(
        (message) => message.session_id === "A" && message.role === "assistant",
      )?.content,
    ).toContain("今日 Token 额度已用尽");
  });
});
