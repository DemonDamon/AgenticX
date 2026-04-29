import type { ChatClient } from "./client";
import type { ChatChunk, ChatRequest, SendMessageResult } from "../types";

type PendingRequest = {
  request: ChatRequest;
  cancelled: boolean;
};

type HttpChatClientOptions = {
  endpoint?: string;
};

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `http_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseErrorPayload(raw: unknown): { code: string; message: string } {
  if (raw && typeof raw === "object" && "error" in raw) {
    const error = (raw as { error?: { code?: unknown; message?: unknown } }).error;
    const code = typeof error?.code === "string" ? error.code : "50000";
    const message = typeof error?.message === "string" ? error.message : "Gateway request failed";
    return { code, message };
  }
  return { code: "50000", message: "Gateway request failed" };
}

export class HttpChatClient implements ChatClient {
  private readonly endpoint: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly controllers = new Map<string, AbortController>();

  public constructor(options: HttpChatClientOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/chat/completions";
  }

  public async sendMessage(req: ChatRequest): Promise<SendMessageResult> {
    const requestId = makeRequestId();
    this.pending.set(requestId, {
      request: req,
      cancelled: false,
    });
    return { requestId };
  }

  public async *stream(requestId: string): AsyncIterable<ChatChunk> {
    const pending = this.pending.get(requestId);
    if (!pending) {
      yield {
        requestId,
        done: true,
        error: {
          code: "40400",
          message: "request not found",
        },
      };
      return;
    }

    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: pending.request.model,
          stream: true,
          messages: pending.request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const parsed = parseErrorPayload(payload);
        yield {
          requestId,
          done: true,
          error: parsed,
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield {
          requestId,
          done: true,
          error: {
            code: "50000",
            message: "empty gateway stream",
          },
        };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIdx = buffer.indexOf("\n\n");
        while (splitIdx >= 0) {
          const frame = buffer.slice(0, splitIdx).trim();
          buffer = buffer.slice(splitIdx + 2);
          splitIdx = buffer.indexOf("\n\n");

          if (!frame.startsWith("data:")) continue;
          const data = frame.replace(/^data:\s*/, "");
          if (data === "[DONE]") {
            yield { requestId, done: true };
            this.pending.delete(requestId);
            return;
          }
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            agenticx_usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };

          // 自定义 usage 事件（gateway 真调流末追加），不算 delta
          if (chunk.agenticx_usage) {
            yield {
              requestId,
              done: false,
              usage: {
                inputTokens: chunk.agenticx_usage.input_tokens ?? 0,
                outputTokens: chunk.agenticx_usage.output_tokens ?? 0,
                totalTokens:
                  chunk.agenticx_usage.total_tokens ??
                  (chunk.agenticx_usage.input_tokens ?? 0) + (chunk.agenticx_usage.output_tokens ?? 0),
              },
            };
            continue;
          }
          // 兼容部分上游在 chunk 上直接带标准 usage
          if (chunk.usage) {
            yield {
              requestId,
              done: false,
              usage: {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens:
                  chunk.usage.total_tokens ??
                  (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
              },
            };
          }

          const delta = chunk.choices?.[0]?.delta?.content;
          const finished = chunk.choices?.[0]?.finish_reason === "stop";
          if (delta) {
            yield {
              requestId,
              done: false,
              delta,
            };
          }
          if (finished) {
            yield { requestId, done: true };
            this.pending.delete(requestId);
            return;
          }
        }
      }
      yield { requestId, done: true };
    } catch (error) {
      yield {
        requestId,
        done: true,
        error: {
          code: pending.cancelled ? "49900" : "50000",
          message: pending.cancelled ? "request cancelled" : error instanceof Error ? error.message : "request failed",
        },
      };
    } finally {
      this.pending.delete(requestId);
      this.controllers.delete(requestId);
    }
  }

  public async cancel(requestId: string): Promise<void> {
    const pending = this.pending.get(requestId);
    if (pending) pending.cancelled = true;
    this.controllers.get(requestId)?.abort();
  }
}

