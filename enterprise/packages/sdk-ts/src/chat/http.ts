import type { ChatClient } from "./client";
import type { DeepResearchEvent } from "../deep-research";
import { newTraceId } from "../trace/trace-id";
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  SendMessageResult,
  WebSearchTrace,
} from "../types";
import { toGatewayMessage } from "./multimodal";

type PendingRequest = {
  request: ChatRequest;
  cancelled: boolean;
  traceId: string;
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

function appendRequestId(message: string, traceId?: string): string {
  const tid = traceId?.trim();
  if (!tid) return message;
  if (message.includes("\n请求 ID: ")) return message;
  return `${message}\n请求 ID: ${tid}`;
}

/** Map browser/undici opaque fetch failures to actionable copy for acceptance UX. */
export function normalizeTransportErrorMessage(raw: string, traceId?: string): string {
  const message = raw.trim();
  if (!message) return appendRequestId("request failed", traceId);
  const lower = message.toLowerCase();
  if (
    lower === "failed to fetch" ||
    lower === "network error" ||
    lower === "networkerror when attempting to fetch resource." ||
    lower.includes("networkerror") ||
    lower === "load failed" ||
    lower.includes("fetch failed")
  ) {
    return appendRequestId(
      "无法连接门户服务（网络中断或开发服务未响应）。" +
        "对话若已显示完整回答，多半是历史同步失败；请确认门户仍在运行后刷新页面，或再发一条消息触发重试。",
      traceId,
    );
  }
  return appendRequestId(message, traceId);
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

const MAX_TRACE_REASON_CHARS = 500;
const MAX_TRACE_QUERY_CHARS = 2_000;
const MAX_TRACE_PROVIDER_ID_CHARS = 200;
const MAX_TRACE_FACETS = 5;
const MAX_TRACE_COUNT = 10_000;
const MAX_TRACE_DURATION_MS = 10 * 60 * 1_000;

function traceString(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value ? value.slice(0, max) : undefined;
}

function traceInteger(raw: unknown, max: number): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(Math.trunc(raw), max);
}

function parseWebSearchTrace(raw: unknown): WebSearchTrace | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || (row.decision !== "search" && row.decision !== "skip")) {
    return undefined;
  }
  const reason = traceString(row.reason, MAX_TRACE_REASON_CHARS);
  const providerCalls = traceInteger(row.providerCalls, MAX_TRACE_COUNT);
  if (!reason || providerCalls === undefined) return undefined;

  const resolvedQuery = traceString(row.resolvedQuery, MAX_TRACE_QUERY_CHARS);
  const sanitizedFacets = Array.isArray(row.facets)
    ? row.facets.slice(0, MAX_TRACE_FACETS).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const facet = item as Record<string, unknown>;
        const query = traceString(facet.query, MAX_TRACE_QUERY_CHARS);
        const hitCount = traceInteger(facet.hitCount, MAX_TRACE_COUNT);
        const uniqueHosts = traceInteger(facet.uniqueHosts, MAX_TRACE_COUNT);
        if (!query || hitCount === undefined || uniqueHosts === undefined) return [];
        const providerIds = Array.isArray(facet.providerIds)
          ? facet.providerIds.slice(0, 2).flatMap((providerId) => {
              const value = traceString(providerId, MAX_TRACE_PROVIDER_ID_CHARS);
              return value ? [value] : [];
            })
          : [];
        const dateFrom = traceString(facet.dateFrom, 32);
        const dateTo = traceString(facet.dateTo, 32);
        return [{
          query,
          ...(providerIds.length > 0 ? { providerIds } : {}),
          hitCount,
          uniqueHosts,
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }];
      })
    : [];

  let retry: WebSearchTrace["retry"];
  if (row.retry && typeof row.retry === "object" && !Array.isArray(row.retry)) {
    const value = row.retry as Record<string, unknown>;
    const queryIndex = traceInteger(value.queryIndex, MAX_TRACE_COUNT);
    const retryReason = traceString(value.reason, MAX_TRACE_REASON_CHARS);
    const fromProviderId = traceString(value.fromProviderId, MAX_TRACE_PROVIDER_ID_CHARS);
    const toProviderId = traceString(value.toProviderId, MAX_TRACE_PROVIDER_ID_CHARS);
    if (
      value.used === true &&
      queryIndex !== undefined &&
      queryIndex < MAX_TRACE_FACETS &&
      retryReason &&
      fromProviderId &&
      toProviderId
    ) {
      retry = { used: true, queryIndex, reason: retryReason, fromProviderId, toProviderId };
    }
  }

  let timings: WebSearchTrace["timings"];
  if (row.timings && typeof row.timings === "object" && !Array.isArray(row.timings)) {
    const value = row.timings as Record<string, unknown>;
    const queryResolutionMs = traceInteger(value.queryResolutionMs, MAX_TRACE_DURATION_MS);
    const retrievalMs = traceInteger(value.retrievalMs, MAX_TRACE_DURATION_MS);
    if (queryResolutionMs !== undefined && retrievalMs !== undefined) {
      timings = { queryResolutionMs, retrievalMs };
    }
  }

  return {
    version: 1,
    decision: row.decision,
    reason,
    ...(resolvedQuery ? { resolvedQuery } : {}),
    ...(sanitizedFacets.length > 0 ? { facets: sanitizedFacets } : {}),
    providerCalls,
    ...(retry ? { retry } : {}),
    ...(timings ? { timings } : {}),
  };
}

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

function cleanReasoningDelta(raw: string): string {
  return raw.replaceAll(THINK_OPEN, "").replaceAll(THINK_CLOSE, "");
}

/** Preserve reasoning before visible content when a gateway uses split fields. */
class StreamDeltaComposer {
  private reasoningOpen = false;

  merge(deltaObj: { content?: string; reasoning_content?: string } | undefined): string | undefined {
    if (!deltaObj) return undefined;
    let output = "";
    const reasoning =
      typeof deltaObj.reasoning_content === "string"
        ? cleanReasoningDelta(deltaObj.reasoning_content)
        : "";
    let content = typeof deltaObj.content === "string" ? deltaObj.content : "";

    if (reasoning) {
      if (!this.reasoningOpen) {
        output += THINK_OPEN;
        this.reasoningOpen = true;
      }
      output += reasoning;
    }
    if (content) {
      if (this.reasoningOpen) {
        content = content.replaceAll(THINK_OPEN, "").replaceAll(THINK_CLOSE, "");
        output += `${THINK_CLOSE}\n`;
        this.reasoningOpen = false;
      }
      output += content;
    }
    return output || undefined;
  }

  close(): string | undefined {
    if (!this.reasoningOpen) return undefined;
    this.reasoningOpen = false;
    return THINK_CLOSE;
  }
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
    const traceId = newTraceId();
    this.pending.set(requestId, {
      request: req,
      cancelled: false,
      traceId,
    });
    return { requestId, traceId };
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
          "x-agenticx-trace-id": pending.traceId,
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
          ...(pending.request.deepResearchInteraction?.trim()
            ? { agenticx_deep_research_interaction: pending.request.deepResearchInteraction.trim() }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const parsed = parseErrorPayload(payload);
        yield {
          requestId,
          done: true,
          traceId: pending.traceId,
          error: {
            code: parsed.code,
            message: appendRequestId(parsed.message, pending.traceId),
          },
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield {
          requestId,
          done: true,
          traceId: pending.traceId,
          error: {
            code: "50000",
            message: appendRequestId("empty gateway stream", pending.traceId),
          },
        };
        return;
      }

      const decoder = new TextDecoder();
      const deltaComposer = new StreamDeltaComposer();
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
            const reasoningTail = deltaComposer.close();
            if (reasoningTail) {
              yield { requestId, done: false, delta: reasoningTail };
            }
            notifyQuotaUsageChanged();
            yield { requestId, done: true };
            this.pending.delete(requestId);
            return;
          }
          let chunk: {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
              finish_reason?: string | null;
            }>;
            agenticx_usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
            agenticx_web_search_sources?: Array<{
              title?: string;
              url?: string;
              snippet?: string;
              usedByModel?: boolean;
              publishedAt?: string;
            }>;
            agenticx_web_search_trace?: unknown;
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
              traceId: pending.traceId,
              error: {
                code: chunk.error.code ?? "50000",
                // Preserve structured Gateway/upstream errors. Only exceptions thrown
                // by browser fetch/read are normalized in the outer catch below.
                message: appendRequestId(
                  chunk.error.message ?? "Gateway request failed",
                  pending.traceId,
                ),
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
                  const publishedAt = String(item.publishedAt ?? "").trim();
                  return {
                    title,
                    url,
                    snippet,
                    ...(usedByModel === undefined ? {} : { usedByModel }),
                    ...(publishedAt ? { publishedAt } : {}),
                  };
                })
                .filter((item) => item.url),
            };
            continue;
          }

          const webSearchTrace = parseWebSearchTrace(chunk.agenticx_web_search_trace);
          if (webSearchTrace) {
            yield {
              requestId,
              done: false,
              webSearchTrace,
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
          const delta = deltaComposer.merge(deltaObj);
          if (delta) {
            yield {
              requestId,
              done: false,
              delta,
            };
          }
          // Do NOT treat finish_reason=stop as stream end.
          // Portal BFF appends trailer frames (search sources/trace and usage)
          // after the last content chunk and before data: [DONE]. Returning here drops them.
        }
      }
      const reasoningTail = deltaComposer.close();
      if (reasoningTail) {
        yield { requestId, done: false, delta: reasoningTail };
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
          traceId: pending.traceId,
          error: {
            code: "50000",
            message: normalizeTransportErrorMessage(
              error instanceof Error ? error.message : "request failed",
              pending.traceId,
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
