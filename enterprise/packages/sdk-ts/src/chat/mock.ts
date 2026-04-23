import type { ChatClient } from "./client";
import type { ChatChunk, ChatRequest, SendMessageResult } from "../types";

type PendingRequest = {
  requestId: string;
  text: string;
  cursor: number;
  cancelled: boolean;
};

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildMockReply(req: ChatRequest): string {
  const latestUserInput = [...req.messages].reverse().find((message) => message.role === "user")?.content?.trim() ?? "";
  const base = latestUserInput || "你好，这是测试消息。";
  return `Mock(${req.model}): 已收到你的消息「${base}」。这是一个模拟 SSE 字符流输出。`;
}

export class MockChatClient implements ChatClient {
  private readonly pending = new Map<string, PendingRequest>();

  public async sendMessage(req: ChatRequest): Promise<SendMessageResult> {
    const requestId = makeRequestId();
    this.pending.set(requestId, {
      requestId,
      text: buildMockReply(req),
      cursor: 0,
      cancelled: false,
    });
    return { requestId };
  }

  public async *stream(requestId: string): AsyncIterable<ChatChunk> {
    const pendingRequest = this.pending.get(requestId);
    if (!pendingRequest) {
      yield {
        requestId,
        done: true,
        error: {
          code: "REQUEST_NOT_FOUND",
          message: `Unknown requestId: ${requestId}`,
        },
      };
      return;
    }

    while (pendingRequest.cursor < pendingRequest.text.length) {
      if (pendingRequest.cancelled) {
        this.pending.delete(requestId);
        yield {
          requestId,
          done: true,
          error: {
            code: "REQUEST_CANCELLED",
            message: "Request has been cancelled by client.",
          },
        };
        return;
      }

      const nextChar = pendingRequest.text[pendingRequest.cursor];
      pendingRequest.cursor += 1;
      yield {
        requestId,
        done: false,
        delta: nextChar,
      };
      await wait(50);
    }

    this.pending.delete(requestId);
    yield {
      requestId,
      done: true,
    };
  }

  public async cancel(requestId: string): Promise<void> {
    const pendingRequest = this.pending.get(requestId);
    if (pendingRequest) {
      pendingRequest.cancelled = true;
    }
  }
}

