import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@agenticx/core-api";
import type { ChatChunk, ChatClient, SendMessageResult } from "@agenticx/sdk-ts";
import { parseAssistantContent } from "./assistant-content";

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

import { STREAM_EMPTY_RESPONSE_ERROR, STREAM_LENGTH_ERROR, useChatStore } from "./store";

function session(): ChatSession {
  const timestamp = "2026-08-20T00:00:00.000Z";
  return {
    id: "A",
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title: "finish reason",
    message_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

class LengthClient implements ChatClient {
  streamImpl: (requestId: string) => AsyncIterable<ChatChunk>;

  constructor(private readonly finishReason = "length") {
    this.streamImpl = async function* stream(this: LengthClient, requestId: string) {
      yield { requestId, done: false, delta: "<think>先检查约束</think>" };
      yield { requestId, done: true, finishReason: this.finishReason } as ChatChunk;
    }.bind(this);
  }

  async sendMessage(): Promise<SendMessageResult> {
    return { requestId: "length-request", traceId: "01J0000000000000000000000C" };
  }

  stream(requestId: string): AsyncIterable<ChatChunk> {
    return this.streamImpl(requestId);
  }

  async cancel(_requestId: string): Promise<void> {}
}

describe("chat store finish_reason handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      lastSkillIdBySessionId: {},
    });
  });

  it.each(["answer  \n\n\n", "   "])("retains the exact checkpoint prefix on truncation: %j", async (prefix) => {
    const client = new LengthClient();
    client.streamImpl = async function* stream(requestId) {
      yield { requestId, done: false, delta: prefix };
      yield { requestId, done: true, finishReason: "length" } as ChatChunk;
    };
    await useChatStore.getState().sendMessage(client, { content: "answer" });
    const assistant = useChatStore.getState().messages.at(-1)!;
    expect(assistant.content.slice(0, assistant.interruption?.contentLength)).toBe(prefix);
    expect(assistant.content).toContain(STREAM_LENGTH_ERROR);
    expect(assistant.interruption?.reason).toBe("failed");
  });

  it.each(["", "   ", "<think>只有思考</think>", "<think>尚未结束的思考"])(
    "rejects an empty visible answer even when the provider reports stop: %j",
    async (content) => {
      const client = new LengthClient("stop");
      client.streamImpl = async function* stream(requestId) {
        yield { requestId, done: false, delta: content };
        yield { requestId, done: true, finishReason: "stop" } as ChatChunk;
      };
      await useChatStore.getState().sendMessage(client, { content: "生成正文" });
      const state = useChatStore.getState();
      const assistant = state.messages.at(-1)!;
      expect(state.status).toBe("error");
      expect(state.errorMessage).toBe(STREAM_EMPTY_RESPONSE_ERROR);
      expect(parseAssistantContent(assistant, false).displayContent).toContain(STREAM_EMPTY_RESPONSE_ERROR);
      expect(parseAssistantContent(assistant, false).thinkingInProgress).toBe(false);
      expect(assistant.content.startsWith(content)).toBe(true);
    },
  );

  it("checks regenerated and edited turns for an empty answer", async () => {
    const client = new LengthClient("stop");
    await useChatStore.getState().sendMessage(client, { content: "first" });
    const user = useChatStore.getState().messages.find((message) => message.role === "user")!;
    await useChatStore.getState().editUserMessageAndResend(client, { messageId: user.id, content: "edited" });
    let state = useChatStore.getState();
    expect(state.errorMessage).toBe(STREAM_EMPTY_RESPONSE_ERROR);
    const assistant = state.messages.at(-1)!;
    await useChatStore.getState().regenerateAssistantResponse(client, assistant.id);
    state = useChatStore.getState();
    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe(STREAM_EMPTY_RESPONSE_ERROR);
    const versions = state.responseVersionsByUserMessageId[user.id];
    expect(versions?.versions[versions.activeIndex]?.content).toContain(STREAM_EMPTY_RESPONSE_ERROR);
  });

  it("accepts literal think examples in a code block as visible text", async () => {
    const client = new LengthClient("stop");
    client.streamImpl = async function* stream(requestId) {
      yield { requestId, done: false, delta: "```xml\n<think>示例</think>\n```" };
      yield { requestId, done: true, finishReason: "stop" } as ChatChunk;
    };
    await useChatStore.getState().sendMessage(client, { content: "解释标签" });
    expect(useChatStore.getState().status).not.toBe("error");
  });
});
