import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
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

function assistantMessage(sessionId: string, content: string): ChatMessage {
  return {
    id: `01J0000000000000000000${sessionId}`,
    session_id: sessionId,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    role: "assistant",
    content,
    created_at: "2026-05-03T00:00:00.000Z",
  };
}

function okSessions(sessions: ChatSession[], nextCursor: string | null = null): Response {
  return new Response(JSON.stringify({ data: { sessions, next_cursor: nextCursor } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

class HistoryTestClient implements ChatClient {
  public readonly requests: ChatRequest[] = [];

  async sendMessage(request: ChatRequest): Promise<SendMessageResult> {
    this.requests.push(request);
    return { requestId: "req-history", traceId: "01TESTTRACEID000000000001" };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId, done: false, delta: "reply" };
    yield { requestId, done: true };
  }

  async cancel(): Promise<void> {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okMessages(messages: ChatMessage[]): Response {
  return new Response(JSON.stringify({ data: { messages } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("chat store history hydration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState({
      sessions: [session("A", "A"), session("B", "B"), session("C", "C")],
      activeSessionId: "A",
      messages: [],
      hydrated: true,
      historyLoading: false,
      historyListLoaded: false,
      historyNextCursor: null,
      historyLoadingMore: false,
      historyLoadMoreError: null,
      historyPrincipal: null,
      historyError: null,
      sessionMessagesLoading: false,
      status: "idle",
      activeModel: "model-a",
      activeRequestId: null,
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
      streamingSessionId: null,
      streamStateBySessionId: {},
    });
  });

  it("createSession opens a local draft without persisting to history list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useChatStore.getState().createSession({ title: "New chat" });

    expect(fetchMock).not.toHaveBeenCalled();
    const state = useChatStore.getState();
    expect(state.sessions).toHaveLength(3);
    expect(state.draftSessionId).toBe(state.activeSessionId);
    expect(state.sessions.some((session) => session.id === state.draftSessionId)).toBe(false);
  });

  it("ignores stale switchSession failures after a newer session is selected", async () => {
    const b = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/B/messages")) return b.promise;
        if (url.includes("/C/messages")) return Promise.resolve(okMessages([assistantMessage("C", "latest")]));
        return Promise.resolve(okMessages([]));
      })
    );

    const switchToB = useChatStore.getState().switchSession("B");
    const switchToC = useChatStore.getState().switchSession("C");
    await switchToC;

    b.reject(new Error("network down"));
    await switchToB.catch(() => undefined);

    const state = useChatStore.getState();
    expect(state.activeSessionId).toBe("C");
    expect(state.sessionMessagesLoading).toBe(false);
    expect(state.messages).toEqual([assistantMessage("C", "latest")]);
  });

  it("publishes the first session page before preferred messages arrive", async () => {
    let releaseMessages!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/chat/sessions?limit=40")) {
          return Promise.resolve(okSessions([session("A", "A")], "next-page"));
        }
        if (url.includes("/A/messages")) {
          return gate.then(() => okMessages([assistantMessage("A", "restored")]));
        }
        if (url.includes("/api/chat/deep-research/runs")) {
          return Promise.resolve(new Response(JSON.stringify({ data: { runs: [] } }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
      }),
    );
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      draftSessionId: null,
      hydrated: false,
      historyListLoaded: false,
    });

    const hydration = useChatStore.getState().hydrateSessions();
    await vi.waitFor(() => expect(useChatStore.getState().historyListLoaded).toBe(true));
    expect(useChatStore.getState().hydrated).toBe(false);
    expect(useChatStore.getState().sessions.map((item) => item.id)).toEqual(["A"]);
    expect(useChatStore.getState().historyNextCursor).toBe("next-page");

    releaseMessages();
    await hydration;
    expect(useChatStore.getState().hydrated).toBe(true);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(["restored"]);
  });

  it("persists a draft after the session list loads and before message hydration finishes", async () => {
    const created = session("01J00000000000000000000099", "first question");
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chat/sessions" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ data: { session: created } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }));
      }
      if (url.includes("/messages") && init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      hydrated: false,
      historyListLoaded: true,
      historyPrincipal: null,
      draftSessionId: null,
    });

    await useChatStore.getState().createSession();
    await useChatStore.getState().sendMessage(new HistoryTestClient(), { content: "first question" });

    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/chat/sessions" && call[1]?.method === "POST")).toBe(true);
    expect(useChatStore.getState().hydrated).toBe(false);
    expect(useChatStore.getState().activeSessionId).toBe(created.id);
    expect(useChatStore.getState().messages.some((message) => message.role === "user" && message.content === "first question")).toBe(true);
  });

  it("appends the next session page without duplicating sessions already loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        expect(url).toContain("cursor=cursor-1");
        return Promise.resolve(okSessions([session("A", "A"), session("B", "B")], null));
      }),
    );
    useChatStore.setState({
      sessions: [session("A", "A")],
      historyNextCursor: "cursor-1",
      hydrated: true,
    });

    await useChatStore.getState().loadMoreSessions();
    const ids = useChatStore.getState().sessions.map((item) => item.id);
    expect(ids.filter((id) => id === "A")).toHaveLength(1);
    expect(ids).toContain("B");
    expect(useChatStore.getState().historyNextCursor).toBeNull();
    expect(useChatStore.getState().historyLoadingMore).toBe(false);
  });
});
