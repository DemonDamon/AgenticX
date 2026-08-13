import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

const historyClientMocks = vi.hoisted(() => ({
  appendMessages: vi.fn(),
  replaceMessages: vi.fn(),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessages: historyClientMocks.appendMessages,
    replaceMessages: historyClientMocks.replaceMessages,
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

class CapturingClient implements ChatClient {
  public readonly requests: ChatRequest[] = [];
  private seq = 0;
  public streamSources = false;
  public streamTrace = false;
  public streamError: { code: string; message: string } | undefined;
  public cancelAfterSources = false;
  public afterSources: (() => void) | undefined;

  async sendMessage(req: ChatRequest): Promise<SendMessageResult> {
    this.requests.push(req);
    this.seq += 1;
    return { requestId: `req-${this.seq}` };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    if (this.streamSources) {
      yield {
        requestId,
        done: false,
        webSearchSources: [
          { title: "Example", url: "https://example.com/a", snippet: "snip" },
        ],
      };
      this.afterSources?.();
      if (this.cancelAfterSources) {
        yield { requestId, done: true, cancelled: true };
        return;
      }
    }
    if (this.streamTrace) {
      yield {
        requestId,
        done: false,
        webSearchTrace: {
          version: 1,
          decision: "search",
          reason: "current information requested",
          resolvedQuery: "latest policy 2026-08-12",
          facets: [{ query: "latest policy 2026-08-12", hitCount: 7, uniqueHosts: 5 }],
          providerCalls: 1,
        },
      };
    }
    if (this.streamError) {
      yield { requestId, done: true, error: this.streamError };
      return;
    }
    yield { requestId, done: false, delta: "ok" };
    yield { requestId, done: true };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

describe("chat store webSearch request wiring", () => {
  beforeEach(() => {
    historyClientMocks.appendMessages.mockReset().mockResolvedValue(undefined);
    historyClientMocks.replaceMessages.mockReset().mockResolvedValue(undefined);
    useChatStore.setState({
      sessions: [session("A", "web search")],
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
      lastDeepResearchAutoBySessionId: {},
    });
  });

  it("forwards webSearch=true on sendMessage", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "search please", webSearch: true });
    expect(client.requests[0]?.webSearch).toBe(true);
    expect(useChatStore.getState().lastWebSearchBySessionId.A).toBe(true);
  });

  it("omits webSearch when toggle is off", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "no search", webSearch: false });
    expect(client.requests[0]?.webSearch).toBeUndefined();
    expect(useChatStore.getState().lastWebSearchBySessionId.A).toBe(false);
  });

  it("keeps webSearch=true on regenerateAssistantResponse", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "latest news", webSearch: true });

    const assistantId = useChatStore.getState().messages.find((m) => m.role === "assistant")?.id;
    expect(assistantId).toBeTruthy();

    await useChatStore.getState().regenerateAssistantResponse(client, assistantId!);
    expect(client.requests.length).toBeGreaterThanOrEqual(2);
    expect(client.requests.at(-1)?.webSearch).toBe(true);
  });

  it("uses the explicit composer mode when retrying after volatile mode state was lost", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "read this URL", webSearch: true });

    const assistantId = useChatStore.getState().messages.find((m) => m.role === "assistant")?.id;
    expect(assistantId).toBeTruthy();
    useChatStore.setState({ lastWebSearchBySessionId: {} });

    await useChatStore
      .getState()
      .regenerateAssistantResponse(client, assistantId!, { webSearch: true });

    expect(client.requests.at(-1)?.webSearch).toBe(true);
    expect(useChatStore.getState().lastWebSearchBySessionId.A).toBe(true);
  });

  it("uses the explicit composer mode when editing after volatile mode state was lost", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "read this URL", webSearch: true });

    const userId = useChatStore.getState().messages.find((m) => m.role === "user")?.id;
    expect(userId).toBeTruthy();
    useChatStore.setState({ lastWebSearchBySessionId: {} });

    await useChatStore.getState().editUserMessageAndResend(client, {
      messageId: userId!,
      content: "read this URL carefully",
      webSearch: true,
    });

    expect(client.requests.at(-1)?.webSearch).toBe(true);
    expect(useChatStore.getState().lastWebSearchBySessionId.A).toBe(true);
  });

  it("allows the current composer mode to disable search on retry", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "latest news", webSearch: true });

    const assistantId = useChatStore.getState().messages.find((m) => m.role === "assistant")?.id;
    expect(assistantId).toBeTruthy();

    await useChatStore
      .getState()
      .regenerateAssistantResponse(client, assistantId!, { webSearch: false });

    expect(client.requests.at(-1)?.webSearch).toBeUndefined();
    expect(useChatStore.getState().lastWebSearchBySessionId.A).toBe(false);
  });

  it("attaches webSearchSources from stream chunks onto the assistant message", async () => {
    const client = new CapturingClient();
    client.streamSources = true;
    await useChatStore.getState().sendMessage(client, { content: "with sources", webSearch: true });
    const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant");
    expect(assistant?.web_search_sources).toEqual([
      { title: "Example", url: "https://example.com/a", snippet: "snip" },
    ]);
    expect(assistant?.content).toBe("ok");
  });

  it("preserves source-first citations in memory and the history append payload", async () => {
    const client = new CapturingClient();
    client.streamSources = true;
    client.afterSources = () => {
      useChatStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.role === "assistant" ? { ...message, web_search_sources: undefined } : message,
        ),
      }));
    };

    await useChatStore.getState().sendMessage(client, { content: "persist sources", webSearch: true });

    const expectedSources = [
      { title: "Example", url: "https://example.com/a", snippet: "snip" },
    ];
    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant");
    expect(assistant?.web_search_sources).toEqual(expectedSources);

    const appendPayload = historyClientMocks.appendMessages.mock.calls.at(-1)?.[1] as
      | Array<{ role: string; web_search_sources?: unknown[] }>
      | undefined;
    expect(appendPayload?.find((message) => message.role === "assistant")?.web_search_sources).toEqual(
      expectedSources,
    );
  });

  it("attaches and persists webSearchTrace from stream chunks", async () => {
    const client = new CapturingClient();
    client.streamTrace = true;
    await useChatStore.getState().sendMessage(client, { content: "trace this", webSearch: true });

    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant");
    expect(assistant?.web_search_trace).toMatchObject({
      version: 1,
      decision: "search",
      providerCalls: 1,
      resolvedQuery: "latest policy 2026-08-12",
    });
    const appendPayload = historyClientMocks.appendMessages.mock.calls.at(-1)?.[1] as
      | Array<{ role: string; web_search_trace?: unknown }>
      | undefined;
    expect(appendPayload?.find((message) => message.role === "assistant")?.web_search_trace).toEqual(
      assistant?.web_search_trace,
    );
  });

  it("persists the user first and retains a source-first stream error", async () => {
    const client = new CapturingClient();
    client.streamSources = true;
    client.streamError = { code: "50000", message: "answer model timed out" };

    await useChatStore.getState().sendMessage(client, {
      content: "latest paper",
      webSearch: true,
    });

    expect(historyClientMocks.appendMessages).toHaveBeenCalledTimes(2);
    const firstPayload = historyClientMocks.appendMessages.mock.calls[0]?.[1] as
      | Array<{ role: string; content: string }>
      | undefined;
    const secondPayload = historyClientMocks.appendMessages.mock.calls[1]?.[1] as
      | Array<{ role: string; content: string; web_search_sources?: unknown[] }>
      | undefined;
    expect(firstPayload).toEqual([
      expect.objectContaining({ role: "user", content: "latest paper" }),
    ]);
    expect(secondPayload).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("answer model timed out"),
        web_search_sources: [
          expect.objectContaining({ url: "https://example.com/a" }),
        ],
      }),
    ]);
  });

  it("persists retrieved sources when cancellation happens before the first answer token", async () => {
    const client = new CapturingClient();
    client.streamSources = true;
    client.cancelAfterSources = true;

    await useChatStore.getState().sendMessage(client, {
      content: "latest paper",
      webSearch: true,
    });

    expect(historyClientMocks.appendMessages).toHaveBeenCalledTimes(2);
    expect(historyClientMocks.appendMessages.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "",
        web_search_sources: [
          expect.objectContaining({ url: "https://example.com/a" }),
        ],
      }),
    ]);
  });
});
