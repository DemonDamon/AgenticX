/**
 * Portal BFF web-search turn: server-side search first, then stream a grounded answer.
 *
 * Why not OpenAI tools probe for MiniMax-class models:
 * - Many providers ignore tool_choice / emit prose or proprietary XML (minimax:tool_call)
 * - User toggle already means "must search"; waiting on model tool_calls is brittle
 *
 * Stream reliability (production):
 * - Sources are emitted before answer tokens so the UI can show the search row early.
 * - Upstream read failures MUST become SSE `error` frames (never hard-close the body),
 *   otherwise the browser surfaces opaque "network error" / "Failed to fetch".
 * - Search failures and gateway failures are separate paths (do not mis-label gateway
 *   outages as "联网搜索暂不可用").
 */

import { stripEmptyAssistantMessages } from "../chat-completion-sanitize";
import { withCurrentTimeContext } from "../current-time";
import { executeWebSearch, formatHits, type WebSearchHit, type WebSearchRuntimeConfig } from "./providers";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "./config";
import { classifyWebSearchNeed } from "./search-necessity";

export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "检索公开网页，获取最新资讯、实时数据，以及超出模型知识截止日期的信息。用户问题涉及时效性、当前事实或外部网页时必须调用。" +
      "禁止用本工具查询当前公历日期、星期或时刻；那些必须以系统提示「当前时间」章节为准。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，使用与问题相同的语言" },
        max_results: { type: "integer", description: "返回结果条数，1-50，默认 50" },
      },
      required: ["query"],
    },
  },
} as const;

export const WEB_SEARCH_SYSTEM_HINT =
  "系统已完成联网搜索，并将结果附在下方。请严格基于这些结果作答；事实句末用 [N] 标注来源编号。" +
  "必须直接提炼并给出可核验事实（如天气状况、气温、湿度、风力、时间、价格、版本号等），用简洁结构化表述回复用户。" +
  "禁止只罗列网站名称、禁止让用户自行打开链接查看；禁止输出「推荐查询渠道」式清单来代替答案。" +
  "若片段不足以完全回答，先基于已有信息尽力汇总，并明确哪些字段不确定；仍禁止声称无法联网。" +
  "例外：当前公历日期、星期、时刻必须以系统提示「当前时间」章节为准，禁止用搜索结果覆盖本机日期。" +
  "禁止输出任何工具调用 XML/标签（包括 minimax:tool_call、<invoke>、tool_call 等）。";

/**
 * Injected on search-skip turns so thinking models (Kimi-like) do not narrate
 * "不需要复杂的功能调用" — the toggle stays on, but this turn needs no tools.
 */
export const TRIVIAL_TURN_SYSTEM_HINT =
  "## 本轮说明\n" +
  "用户本轮是寒暄、简单确认或无需外部检索的问题。请直接友好地回复。\n" +
  "思考过程与回复中都不要提及工具、功能调用、联网搜索、function call、tool_call。\n";

const TRIVIAL_TURN_MARKER = "## 本轮说明";

/** @deprecated Kept for tests / compatibility; search-first path does not probe tools. */
export const WEB_SEARCH_TOOL_CHOICE = {
  type: "function",
  function: { name: "web_search" },
} as const;

const ADMIN_DISABLED_HINT = "> 管理员已关闭联网搜索。\n\n";
const UNAVAILABLE_HINT = "> 联网搜索暂不可用，以下回答基于模型已有知识。\n\n";

/** Cap model-bound context (UI sources may still list the full hit set). */
export const WEB_SEARCH_CONTEXT_HIT_LIMIT = 10;
export const WEB_SEARCH_CONTEXT_SNIPPET_CHARS = 320;

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

export type GatewayFetchDeps = {
  url: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  loadTenantConfig?: () => Promise<TenantWebSearchRow>;
  executeSearch?: typeof executeWebSearch;
};

function sseDataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function formatSseErrorFrame(message: string, code = "50201"): string {
  return sseDataFrame({
    error: {
      code,
      message,
    },
  });
}

export function synthesizeTextSse(
  content: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  },
): string {
  const frames: string[] = [];
  if (usage) {
    frames.push(sseDataFrame({ usage }));
  }
  if (content) {
    frames.push(sseDataFrame({ choices: [{ delta: { content } }] }));
  }
  frames.push("data: [DONE]\n\n");
  return frames.join("");
}

/** Keep search keywords short — full document dumps make DDG challenge / return empty. */
export const MAX_WEB_SEARCH_QUERY_CHARS = 240;

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string" && row.text.trim()) {
      parts.push(row.text.trim());
    }
  }
  return parts.join("\n").trim();
}

/**
 * Strip portal-injected attachment bodies (`--- 附件: name ---…`) so web search
 * uses the user's short question (e.g. 「总结一下」), not the whole parsed file.
 */
export function sanitizeWebSearchQuery(raw: string, maxChars = MAX_WEB_SEARCH_QUERY_CHARS): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const attachIdx = text.search(/\n---\s*附件\s*[:：]/);
  if (attachIdx >= 0) {
    text = text.slice(0, attachIdx).trim();
  } else if (/^---\s*附件\s*[:：]/.test(text)) {
    // User sent attachment-only turn — fall back to filename line if present.
    const nameMatch = text.match(/^---\s*附件\s*[:：]\s*(.+?)\s*---/);
    text = nameMatch?.[1]?.trim() || "";
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd();
}

export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text) return sanitizeWebSearchQuery(text);
  }
  return "";
}

/** Intent-bearing words: short turns containing these are full questions, not slot-fills. */
const FOLLOW_UP_INTENT =
  /天气|气温|温度|湿度|预报|新闻|头条|价格|股价|汇率|怎么样|如何|多少|最新|查询|搜索|财报|官网|是谁|哪里|哪个/;

/**
 * True when last user turn looks like a slot-fill (e.g. city name), not a full question.
 * Used so multi-turn search can keep prior intent: 「今天天气怎么样」→「广州南沙」.
 */
export function isShortFollowUpQuery(query: string): boolean {
  const q = query.trim();
  if (!q || q.length > 24) return false;
  if (FOLLOW_UP_INTENT.test(q)) return false;
  return true;
}

/**
 * Keywords for executeWebSearch on the current turn.
 * Default = last user text. When last is a short follow-up and a previous user
 * turn exists, prepend the slot-fill: 「广州南沙 今天天气怎么样」.
 */
export function buildWebSearchQuery(messages: ChatMessage[]): string {
  const users: string[] = [];
  for (let i = messages.length - 1; i >= 0 && users.length < 2; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (!text) continue;
    users.push(sanitizeWebSearchQuery(text));
  }
  const last = users[0] ?? "";
  if (!last) return "";
  const prev = users[1] ?? "";
  // Only splice when prior turn carried searchable intent (天气/新闻/…), not 「你好」.
  if (!prev || !isShortFollowUpQuery(last) || !FOLLOW_UP_INTENT.test(prev)) return last;
  return sanitizeWebSearchQuery(`${last} ${prev}`);
}

/** Raw last-user text (attachment bodies NOT stripped) — for skip classification. */
export function extractLastUserRawText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text) return text;
  }
  return "";
}

/** Escape hatch: set AGENTICX_WEB_SEARCH_ALWAYS=1 to restore unconditional search-first. */
function webSearchAlwaysOn(): boolean {
  const raw = process.env.AGENTICX_WEB_SEARCH_ALWAYS?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function stripWebSearchFlag<T extends Record<string, unknown>>(body: T): Omit<T, "agenticx_web_search"> {
  const { agenticx_web_search: _ignored, ...rest } = body;
  return rest;
}

/** Structured SSE frame (not mixed into delta.content). */
export function formatWebSearchSourcesSse(hits: WebSearchHit[]): string {
  const payload = hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: hit.snippet,
  }));
  return sseDataFrame({ agenticx_web_search_sources: payload });
}

function truncateSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/** Shrink hits before injecting into the model prompt (UI still gets full `hits`). */
export function compactHitsForModel(hits: WebSearchHit[]): WebSearchHit[] {
  return hits.slice(0, WEB_SEARCH_CONTEXT_HIT_LIMIT).map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: truncateSnippet(hit.snippet, WEB_SEARCH_CONTEXT_SNIPPET_CHARS),
  }));
}

export function withSearchContext(messages: ChatMessage[], hits: WebSearchHit[]): ChatMessage[] {
  const resultsBlock =
    `${WEB_SEARCH_SYSTEM_HINT}\n\n--- 联网搜索结果 ---\n${formatHits(hits)}\n--- 搜索结果结束 ---`;
  const next = messages.map((m) => ({ ...m }));
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing ? `${existing}\n\n${resultsBlock}` : resultsBlock,
    };
    return next;
  }
  return [{ role: "system", content: resultsBlock }, ...next];
}

/** Prepend the trivial-turn hint so skip-path reasoning stays Kimi-clean. */
export function withTrivialTurnContext(messages: ChatMessage[]): ChatMessage[] {
  const next = messages.map((m) => ({ ...m }));
  if (
    next[0]?.role === "system" &&
    typeof next[0].content === "string" &&
    next[0].content.includes(TRIVIAL_TURN_MARKER)
  ) {
    return next;
  }
  const block = TRIVIAL_TURN_SYSTEM_HINT.trimEnd();
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing ? `${block}\n\n${existing}` : block,
    };
    return next;
  }
  return [{ role: "system", content: block }, ...next];
}

function eventStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function gatewayUnavailableResponse(detail: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "50301",
        message: `Gateway 不可用：${detail}。请确认网关进程正常，然后重试。`,
      },
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );
}

function extractUpstreamErrorMessage(errText: string, status: number): string {
  const trimmed = errText.trim();
  if (!trimmed) return `上游返回 HTTP ${status || 502}`;
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // keep raw text
  }
  return trimmed.length > 480 ? `${trimmed.slice(0, 480)}…` : trimmed;
}

async function callGatewayStream(
  deps: GatewayFetchDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    return await fetchImpl(deps.url, {
      method: "POST",
      headers: deps.headers,
      body: JSON.stringify(body),
      signal: deps.signal,
    });
  } catch (error) {
    if (deps.signal?.aborted) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "fetch failed";
    throw new Error(`connect ${deps.url}: ${detail}`);
  }
}

type PipeOptions = {
  sourcesFrame?: string;
  prefixText?: string;
};

function frameHasErrorPayload(data: string): boolean {
  if (!data || data === "[DONE]") return false;
  try {
    const parsed = JSON.parse(data) as { error?: unknown };
    return Boolean(parsed && typeof parsed === "object" && parsed.error);
  } catch {
    return false;
  }
}

function frameHasContentDelta(data: string): boolean {
  if (!data || data === "[DONE]") return false;
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
    };
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return false;
    if (typeof delta.content === "string" && delta.content.length > 0) return true;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Pipe an upstream SSE body to the browser. Never leave the client with a hard-closed
 * stream after sources were already sent — always finish with an error frame + [DONE].
 */
export async function pipeUpstreamSse(upstream: Response, options: PipeOptions = {}): Promise<Response> {
  const sourcesFrame = options.sourcesFrame ?? "";
  const prefixText = options.prefixText ?? "";

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "gateway error");
    const message = extractUpstreamErrorMessage(errText, upstream.status);
    if (sourcesFrame) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(sourcesFrame));
          controller.enqueue(
            encoder.encode(
              formatSseErrorFrame(`模型回答失败：${message}`, String(upstream.status || 502)),
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return eventStreamResponse(stream);
    }
    return new Response(errText, {
      status: upstream.status || 502,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let sawDone = false;
      let sawError = false;
      let sawContent = false;
      try {
        if (prefixText) {
          const prefix = synthesizeTextSse(prefixText).replace("data: [DONE]\n\n", "");
          controller.enqueue(encoder.encode(prefix));
          sawContent = true;
        }
        if (sourcesFrame) {
          controller.enqueue(encoder.encode(sourcesFrame));
        }

        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf("\n\n");
            const dataLine = frame
              .split("\n")
              .map((line) => line.trim())
              .find((line) => line.startsWith("data:"));
            if (!dataLine) {
              controller.enqueue(encoder.encode(`${frame}\n\n`));
              continue;
            }
            const data = dataLine.replace(/^data:\s*/, "");
            if (data === "[DONE]") {
              sawDone = true;
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            if (frameHasErrorPayload(data)) {
              sawError = true;
            }
            if (frameHasContentDelta(data)) {
              sawContent = true;
            }
            controller.enqueue(encoder.encode(`${frame}\n\n`));
          }
        }

        if (!sawDone && !sawError && !sawContent && sourcesFrame) {
          controller.enqueue(
            encoder.encode(
              formatSseErrorFrame(
                "上游模型在联网检索后未返回内容，连接已中断。请重试，或先关闭联网搜索后再试。",
              ),
            ),
          );
          sawError = true;
        }
        if (!sawDone) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        controller.close();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "stream interrupted";
        try {
          if (!sawError) {
            controller.enqueue(
              encoder.encode(
                formatSseErrorFrame(
                  `聊天流式连接中断：${detail}。若刚完成联网搜索，多为网关或上游模型超时/断连，请重试。`,
                ),
              ),
            );
          }
          if (!sawDone) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        } catch {
          try {
            controller.error(error);
          } catch {
            // controller already closed
          }
        }
      }
    },
  });
  return eventStreamResponse(stream);
}

async function pipeWithPrefix(upstream: Response, prefixText: string): Promise<Response> {
  return pipeUpstreamSse(upstream, { prefixText });
}

async function pipeWithSourcesAppendix(upstream: Response, hits: WebSearchHit[]): Promise<Response> {
  const sourcesFrame = hits.length > 0 ? formatWebSearchSourcesSse(hits) : "";
  return pipeUpstreamSse(upstream, { sourcesFrame });
}

export async function runWebSearchTurn(
  parsedBody: Record<string, unknown>,
  deps: GatewayFetchDeps,
): Promise<Response> {
  const baseBody = stripWebSearchFlag(parsedBody);
  const originalMessages = stripEmptyAssistantMessages(
    Array.isArray(baseBody.messages) ? (baseBody.messages as ChatMessage[]) : [],
  );

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const cfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);
  const { tools: _tools, tool_choice: _toolChoice, ...rest } = baseBody;

  if (!cfg.enabled) {
    try {
      const upstream = await callGatewayStream(deps, {
        ...rest,
        stream: true,
        messages: withCurrentTimeContext(originalMessages),
      });
      return pipeWithPrefix(upstream, ADMIN_DISABLED_HINT);
    } catch (error) {
      return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
    }
  }

  // Skip classification uses the bare last-user turn (greetings must not inherit prior intent).
  const queryForSkip = extractLastUserQuery(originalMessages);
  // Search keywords may splice a short slot-fill onto the previous user intent.
  const query = buildWebSearchQuery(originalMessages);

  // Before: only pure date/time questions short-circuited search-first.
  // After: any self-contained turn (greeting / assistant meta / attachment-only /
  // arithmetic / datetime) answers directly — matching Doubao / Kimi behavior where
  // the toggle stays on but trivial turns do not pay an外网 round-trip.
  const skip = webSearchAlwaysOn()
    ? null
    : classifyWebSearchNeed({
        query: queryForSkip,
        rawQuery: extractLastUserRawText(originalMessages),
      });
  if (skip && skip.need === "skip") {
    console.info(`[web-search] skipped search-first (reason=${skip.reason})`);
    try {
      const upstream = await callGatewayStream(deps, {
        ...rest,
        stream: true,
        // Hint first so thinking models do not narrate "无需功能调用".
        messages: withTrivialTurnContext(withCurrentTimeContext(originalMessages)),
      });
      return pipeUpstreamSse(upstream, {});
    } catch (error) {
      return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
    }
  }

  const searchFn = deps.executeSearch ?? executeWebSearch;
  let hits: WebSearchHit[] = [];
  let searchFailed = false;

  try {
    if (!query) {
      throw new Error("missing user query for web search");
    }
    hits = await searchFn(query, undefined, cfg);
    if (hits.length === 0) {
      throw new Error("search returned no hits");
    }
  } catch (error) {
    searchFailed = true;
    console.warn("[web-search] search failed, degrading:", error instanceof Error ? error.message : error);
  }

  const messages = withCurrentTimeContext(
    searchFailed
      ? originalMessages
      : withSearchContext(originalMessages, compactHitsForModel(hits)),
  );

  let upstream: Response;
  try {
    upstream = await callGatewayStream(deps, {
      ...rest,
      stream: true,
      messages,
    });
  } catch (error) {
    return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
  }

  if (searchFailed) {
    return pipeWithPrefix(upstream, UNAVAILABLE_HINT);
  }
  return pipeWithSourcesAppendix(upstream, hits);
}
