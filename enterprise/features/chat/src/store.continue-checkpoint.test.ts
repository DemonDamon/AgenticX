import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@agenticx/core-api";
import type { ChatChunk, ChatClient } from "@agenticx/sdk-ts";

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

const tenantId = "01J00000000000000000000001";
const userId = "01J00000000000000000000004";
const ts = "2026-05-03T00:00:00.000Z";
const SESSION_ID = "01M00000000000000000000003";
const USER_ID = "01M00000000000000000000U01".replace("U", "1");
const ASSISTANT_ID = "01M00000000000000000000A01".replace("A", "2");

function session(id: string): ChatSession {
  return { id, tenant_id: tenantId, user_id: userId, title: "Test", message_count: 2, created_at: ts, updated_at: ts };
}

/** Streams one delta, pauses past the first-checkpoint delay, then finishes. */
class SlowClient implements ChatClient {
  async sendMessage() {
    return { requestId: "req-1", traceId: "01M00000000000000000000000" };
  }
  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    yield { requestId, done: false, delta: "前半段，" };
    await new Promise((resolve) => setTimeout(resolve, 1400));
    yield { requestId, done: false, delta: "写完了。" };
    yield { requestId, done: true };
  }
  async cancel() {}
}

describe("continueResponse checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const user: ChatMessage = {
      id: USER_ID,
      session_id: SESSION_ID,
      tenant_id: tenantId,
      user_id: userId,
      role: "user",
      content: "写一段话",
      created_at: ts,
    };
    const assistant: ChatMessage = {
      id: ASSISTANT_ID,
      session_id: SESSION_ID,
      tenant_id: tenantId,
      user_id: userId,
      role: "assistant",
      content: "本次生成超过时限，已停止。",
      model: "test-model",
      interruption: { reason: "failed", contentLength: 0 },
      created_at: "2026-05-03T00:00:01.000Z",
    };
    useChatStore.setState({
      sessions: [session(SESSION_ID)],
      activeSessionId: SESSION_ID,
      messages: [user, assistant],
      hydrated: true,
      status: "idle",
      activeModel: "test-model",
      streamStateBySessionId: {},
      errorMessage: null,
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
    });
  });

  it("checkpoints a continuation that restarts after an empty failed answer, then clears the interruption", async () => {
    await useChatStore.getState().continueResponse(new SlowClient(), ASSISTANT_ID);

    const assistantWrites = appendMessages.mock.calls
      .map(([, messages]) => (messages as ChatMessage[]).find((message) => message.id === ASSISTANT_ID))
      .filter((message): message is ChatMessage => Boolean(message));

    const midStream = assistantWrites.find((message) => message.interruption?.reason === "disconnected");
    expect(midStream).toBeDefined();
    expect(midStream!.content).toBe("前半段，");
    expect(midStream!.content).not.toContain("超过时限");
    expect(midStream!.model).toBe("test-model");
    expect(midStream!.interruption!.contentLength).toBe(midStream!.content.length);

    const last = assistantWrites.at(-1)!;
    expect(last.content).toBe("前半段，写完了。");
    expect(last.interruption).toBeUndefined();
  }, 10_000);
});
