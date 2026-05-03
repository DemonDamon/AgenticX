import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
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
      responseVersionsByUserMessageId: {},
    });
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
});
