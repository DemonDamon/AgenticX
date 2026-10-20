import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
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
    deleteSessions: vi.fn(),
    pinSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

import { useChatStore } from "./store";
import { parseAssistantContent } from "./assistant-content";
import { findContinuableResponse } from "./utils/turn-continuation";

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
      expect.objectContaining({
        operationId: expect.any(String),
        payloadHash: expect.any(String),
      }),
    );
  });

  it("flushes buffered text before stop captures the continuation boundary", async () => {
    let started!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const client = {
      async sendMessage() { return { requestId: "buffered", traceId: "01J0000000000000000000000B" }; },
      async *stream(requestId: string) {
        yield { requestId, done: false, delta: "first" };
        yield { requestId, done: false, delta: " buffered" };
        started();
        await gate;
        yield { requestId, done: false, delta: " stale" };
      },
      async cancel() { finish(); },
    };
    const turn = useChatStore.getState().sendMessage(client, { content: "hello" });
    await ready;
    await useChatStore.getState().cancel(client);
    await turn;
    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant");
    expect(assistant).toMatchObject({ content: "first buffered", interruption: { reason: "cancelled", contentLength: 14 } });
    const saved = appendMessages.mock.calls.at(-1)?.[1] as Array<{ role: string; content: string }>;
    expect(saved.find((message) => message.role === "assistant")?.content).toBe("first buffered");
  });

  it("settles cancelled reasoning as a resumable missing answer, including its saved snapshot", async () => {
    let started!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const prefix = "<think>尚在分析问题";
    const client = {
      async sendMessage() { return { requestId: "reasoning-stop", traceId: "01J00000000000000000000001" }; },
      async *stream(requestId: string) {
        yield { requestId, done: false, delta: prefix };
        started();
        await gate;
        yield { requestId, done: true, cancelled: true };
      },
      cancel: vi.fn(async () => { finish(); }),
    };
    const turn = useChatStore.getState().sendMessage(client, { content: "hello" });
    await ready;
    await useChatStore.getState().cancel(client);
    await turn;

    const state = useChatStore.getState();
    const assistant = state.messages.at(-1)!;
    expect(client.cancel).toHaveBeenCalledWith("reasoning-stop");
    expect(state.status).toBe("idle");
    expect(state.streamStateBySessionId.A).toBeUndefined();
    expect(assistant).toMatchObject({
      content: prefix,
      interruption: { reason: "cancelled", contentLength: prefix.length },
    });
    expect(findContinuableResponse(state.messages, "A")?.id).toBe(assistant.id);
    const saved = appendMessages.mock.calls.at(-1)?.[1] as ChatMessage[];
    const savedAssistant = saved.find((message) => message.role === "assistant");
    for (const snapshot of [assistant, savedAssistant]) {
      expect(parseAssistantContent(snapshot!).thinkingInProgress).toBe(false);
      expect(parseAssistantContent(snapshot!).displayContent).toContain("尚未生成最终答复");
    }
  });
});
