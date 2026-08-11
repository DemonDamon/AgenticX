import type { ChatClient } from "./client";
import type { DeepResearchEvent } from "../deep-research";
import type { ChatChunk, ChatMessage, ChatRequest, SendMessageResult } from "../types";
import { toGatewayMessage } from "./multimodal";

type PendingRequest = {
  request: ChatRequest;
  cancelled: boolean;
};

type HttpChatClientOptions = {
  endpoint?: string;
};

/** Browser event emitted after a completed gateway stream settles usage. */
export const QUOTA_USAGE_CHANGED_EVENT = "agenticx:quota-usage-changed";

function notifyQuotaUsageChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUOTA_USAGE_CHANGED_EVENT));
}

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
    // A structured server/upstream error is not a browser transport failure.
    // Preserve it so operators can diagnose the real provider error.
    return { code, message };
  }
  return { code: "50000", message: "Gateway request failed" };
}

/** Map browser/undici opaque fetch failures to actionable copy for acceptance UX. */
export function normalizeTransportErrorMessage(raw: string): string {
  const message = raw.trim();
  if (!message) return "request failed";
  const lower = message.toLowerCase();
  if (
    lower === "failed to fetch" ||
    lower === "network error" ||
    lower === "networkerror when attempting to fetch resource." ||
    lower.includes("networkerror") ||
    lower === "load failed" ||
    lower.includes("fetch failed")
  ) {
    return (
      "无法连接门户服务（网络中断或开发服务未响应）。" +
      "对话若已显示完整回答，多半是历史同步失败；请确认门户仍在运行后刷新页面，或再发一条消息触发重试。"
    );
  }
  return message;
}

/**
 * Cancel a fetch body reader so the browser releases the underlying connection back to the
 * per-origin pool right away. Safe to call after the stream already reached natural EOF
 * (cancelling an already-closed reader resolves without error).
 */
async function releaseStreamReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Reader may already be closed/errored — nothing to release.
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  return name === "AbortError";
}

function pickStreamDelta(deltaObj: { content?: string; reasoning_content?: string } | undefined): string | undefined {
  if (!deltaObj) return undefined;
  const parts: string[] = [];
  if (typeof deltaObj.content === "string" && deltaObj.content.length > 0) {
    parts.push(deltaObj.content);
  }
  if (typeof deltaObj.reasoning_content === "string" && deltaObj.reasoning_content.length > 0) {
    parts.push(deltaObj.reasoning_content);
  }
  return parts.length > 0 ? parts.join("") : undefined;
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
        headers: {
          "content-type": "application/json",
          ...(pending.request.sessionId?.trim()
            ? { "x-chat-session-id": pending.request.sessionId.trim() }
            : {}),
        },
        body: JSON.stringify({
          model: pending.request.model,
          stream: true,
          messages: pending.request.messages.map((message) => toGatewayMessage(message)),
          ...(pending.request.webSearch ? { agenticx_web_search: true } : {}),
          ...(pending.request.deepResearch ? { agenticx_deep_research: true } : {}),
          ...(pending.request.deepResearchAuto ? { agenticx_deep_research_auto: true } : {}),
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
      // Every exit from this block (natural EOF, [DONE] sentinel, chunk.error, or a thrown
      // read error) MUST release the reader immediately. Otherwise the browser keeps the
      // underlying HTTP/1.1 connection out of the per-origin pool (Chrome/Firefox cap at 6),
      // and after ~5-6 chat rounds every subsequent fetch to this origin (new chat, history
      // sync, session switch) queues forever and eventually surfaces as "Failed to fetch".
      try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIdx = buffer.indexOf("\n\n");
        while (splitIdx >= 0) {
          const frame = buffer.slice(0, splitIdx).trim();
          buffer = buffer.slice(splitIdx + 2);
          splitIdx = buffer.indexOf("\n\n");

          const dataLines = frame
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s*/, ""));
          if (dataLines.length === 0) continue;
          const data = dataLines.join("\n");
          if (data === "[DONE]") {
            notifyQuotaUsageChanged();
            yield { requestId, done: true };
            this.pending.delete(requestId);
            return;
          }
          let chunk: {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            agenticx_usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
            agenticx_web_search_sources?: Array<{
              title?: string;
              url?: string;
              snippet?: string;
              usedByModel?: boolean;
            }>;
            agenticx_deep_research_event?: DeepResearchEvent;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            error?: { code?: string; message?: string };
          };
          try {
            chunk = JSON.parse(data) as typeof chunk;
          } catch {
            // Tolerate malformed keepalive / partial frames from proxies.
            continue;
          }

          if (chunk.error) {
            yield {
              requestId,
              done: true,
              error: {
                code: chunk.error.code ?? "50000",
                // Preserve structured Gateway/upstream errors. Only exceptions thrown
                // by browser fetch/read are normalized in the outer catch below.
                message: chunk.error.message ?? "Gateway request failed",
              },
            };
            this.pending.delete(requestId);
            return;
          }

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

          // Portal BFF web-search hits — structured, not delta content
          if (Array.isArray(chunk.agenticx_web_search_sources)) {
            yield {
              requestId,
              done: false,
              webSearchSources: chunk.agenticx_web_search_sources
                .map((item) => {
                  const title = String(item.title ?? "").trim() || item.url || "Untitled";
                  const url = String(item.url ?? "").trim();
                  const snippet = String(item.snippet ?? "").trim();
                  const usedByModel =
                    item.usedByModel === true ? true : item.usedByModel === false ? false : undefined;
                  return {
                    title,
                    url,
                    snippet,
                    ...(usedByModel === undefined ? {} : { usedByModel }),
                  };
                })
                .filter((item) => item.url),
            };
            continue;
          }

          if (chunk.agenticx_deep_research_event && typeof chunk.agenticx_deep_research_event === "object") {
            yield {
              requestId,
              done: false,
              deepResearchEvent: chunk.agenticx_deep_research_event,
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

          const deltaObj = chunk.choices?.[0]?.delta as
            | { content?: string; reasoning_content?: string }
            | undefined;
          const delta = pickStreamDelta(deltaObj);
          if (delta) {
            yield {
              requestId,
              done: false,
              delta,
            };
          }
          // Do NOT treat finish_reason=stop as stream end.
          // Portal BFF appends trailer frames (agenticx_web_search_sources / agenticx_usage)
          // after the last content chunk and before data: [DONE]. Returning here drops them.
        }
      }
      notifyQuotaUsageChanged();
      yield { requestId, done: true };
      } finally {
        await releaseStreamReader(reader);
      }
    } catch (error) {
      if (pending.cancelled || isAbortError(error)) {
        yield { requestId, done: true, cancelled: true };
      } else {
        yield {
          requestId,
          done: true,
          error: {
            code: "50000",
            message: normalizeTransportErrorMessage(
              error instanceof Error ? error.message : "request failed",
            ),
          },
        };
      }
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
