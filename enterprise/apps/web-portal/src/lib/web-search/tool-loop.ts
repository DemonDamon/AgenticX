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
import type { WebSearchTrace } from "@agenticx/core-api";
import { EVIDENCE_DISCIPLINE_HINT } from "../retrieval/evidence-discipline";
import {
  formatEvidenceCoverage,
  summarizeEvidenceFacet,
  type EvidenceFacetSummary,
} from "../retrieval/evidence-profile";
import { diversifyBySourceHost } from "../retrieval/source-diversity";
import {
  resolveInjectionBudgetChars,
  selectHitsWithinBudget,
  WEB_SEARCH_SNIPPET_CHARS,
} from "./context-budget";
import {
  buildSearchQueryRewriteMessages,
  hasPriorSearchQueryLeakage,
  parseSearchQueryRewrite,
  type SearchQueryRewrite,
} from "./follow-up";
import { sanitizeHistoryForUpstream } from "./history-sanitize";
import {
  configForWebSearchProvider,
  configuredWebSearchProviders,
  executeWebSearch,
  formatHits,
  primaryWebSearchProvider,
  WEB_SEARCH_MAX_RESULTS_CAP,
  type WebSearchHit,
  type WebSearchRuntimeConfig,
} from "./providers";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "./config";
import { rerankHits } from "./rerank";
import {
  assessSearchEvidence,
  interleaveSearchHitGroups,
  mergeSearchHits,
  selectAlternativeProvider,
} from "./search-retry";
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
  "## 本轮检索状态\n" +
  "本轮已经由平台成功完成联网搜索，并将结果附在下方；这不是等待用户开启的状态。" +
  "请严格基于这些结果作答；不得说自己不能联网、无法搜索或要求用户手动开启联网搜索。" +
  "事实句末用 [N] 标注来源编号。" +
  "必须直接提炼并给出可核验事实（如天气状况、气温、湿度、风力、时间、价格、版本号等），用简洁结构化表述回复用户。" +
  "禁止只罗列网站名称、禁止让用户自行打开链接查看；禁止输出「推荐查询渠道」式清单来代替答案。" +
  "禁止以「建议直接访问某网站获取详情」「请自行查看某链接」等说法收尾来代替回答——" +
  "即使某些字段（如精确实时数值）片段中未显示，也要先给出片段中能找到的最接近事实" +
  "（如当日/前一日预报的天气状况、温度区间、风力等级等），并直接标注「此为预报数据，" +
  "非实时更新」之类的不确定性说明，而不是让用户自己去查。" +
  "若片段不足以完全回答，先基于已有信息尽力汇总，并明确哪些字段不确定；仍禁止声称无法联网。" +
  "例外：当前公历日期、星期、时刻必须以系统提示「当前时间」章节为准，禁止用搜索结果覆盖本机日期。" +
  "禁止输出任何工具调用 XML/标签（包括 minimax:tool_call、<invoke>、tool_call 等）。" +
  "部分结果附带「发布时间」。若其与系统提示的当前时间相差较大（例如非同一天的天气、非近期的行情），" +
  "须明确标注该数据的日期并说明可能已过时，禁止把历史数据当作今日事实陈述。" +
  "下方 [N] 编号仅对应本轮搜索结果；对话历史中出现过的编号属于往轮、已失效，" +
  "禁止拿历史编号与本轮结果互相比对，也不要因编号对不上而推翻自己此前的结论。" +
  "若本轮结果整体与用户问题无关（例如检索词被泛化、命中的都是同名的其他事物），" +
  "须直接说明「本次检索结果与问题无关」，随后基于对话上下文已确认的事实作答，" +
  "禁止用无关结果拼凑答案或改写此前结论。" +
  EVIDENCE_DISCIPLINE_HINT;

/**
 * Injected on search-skip turns so thinking models (Kimi-like) do not narrate
 * "不需要复杂的功能调用" — the toggle stays on, but this turn needs no tools.
 */
export const TRIVIAL_TURN_SYSTEM_HINT =
  "## 本轮说明\n" +
  "用户本轮是寒暄、简单确认或无需外部检索的问题。请直接友好地回复，不要为了凑答案而联网。\n" +
  "思考过程与回复中都不要提及工具、功能调用、联网搜索、function call、tool_call。\n";

export const ASSISTANT_CAPABILITY_SYSTEM_HINT =
  "## 当前能力说明\n" +
  "用户正在询问助手或平台的能力。请直接回答当前系统状态；如果用户问联网搜索，说明本平台支持联网搜索，" +
  "本轮自动模式会按问题需要决定是否检索，不要声称必须手动开启，也不要把本轮未检索误说成平台不支持。\n";

const TRIVIAL_TURN_MARKER = "## 本轮说明";

/** @deprecated Kept for tests / compatibility; search-first path does not probe tools. */
export const WEB_SEARCH_TOOL_CHOICE = {
  type: "function",
  function: { name: "web_search" },
} as const;

const ADMIN_DISABLED_HINT = "> 管理员已关闭联网搜索。\n\n";
const UNAVAILABLE_HINT = "> 联网搜索暂不可用，以下回答基于模型已有知识。\n\n";
const QUERY_REWRITE_TIMEOUT_MS = 15_000;
const QUERY_REWRITE_MAX_ATTEMPTS = 2;
const QUERY_REWRITE_MAX_TOKENS = 256;

/** @deprecated Prefer WEB_SEARCH_SNIPPET_CHARS from context-budget; kept for test imports. */
export const WEB_SEARCH_CONTEXT_SNIPPET_CHARS = WEB_SEARCH_SNIPPET_CHARS;

export type WebSearchChatMessage = {
  role: string;
  /** Gateway requests may carry OpenAI-style multimodal content parts. */
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

type ChatMessage = WebSearchChatMessage;

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
const PORTAL_ATTACHMENT_AFTER_TEXT = /\n---\s*(?:附件|attachment)\s*[:：]/i;
const PORTAL_ATTACHMENT_AT_START = /^---\s*(?:附件|attachment)\s*[:：]/i;
const PORTAL_ATTACHMENT_NAME =
  /^---\s*(?:附件|attachment)\s*[:：]\s*(.+?)\s*---/i;

export function isPortalAttachmentOnlyTurn(raw: string): boolean {
  return PORTAL_ATTACHMENT_AT_START.test(raw.replace(/\r\n/g, "\n").trim());
}

export function messageContentToText(content: unknown): string {
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
  const attachIdx = text.search(PORTAL_ATTACHMENT_AFTER_TEXT);
  if (attachIdx >= 0) {
    text = text.slice(0, attachIdx).trim();
  } else if (PORTAL_ATTACHMENT_AT_START.test(text)) {
    // User sent attachment-only turn — fall back to filename line if present.
    const nameMatch = text.match(PORTAL_ATTACHMENT_NAME);
    text = nameMatch?.[1]?.trim() || "";
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd();
}

/**
 * Research prompts may put output constraints at the end. Keep both boundaries
 * when bounding them; ordinary provider queries continue using prefix truncation.
 */
export function sanitizeResearchRequest(raw: string, maxChars: number): string {
  const text = sanitizeWebSearchQuery(raw, Number.MAX_SAFE_INTEGER);
  if (text.length <= maxChars) return text;
  const separator = " … ";
  const usable = Math.max(2, maxChars - separator.length);
  const head = Math.ceil(usable / 2);
  const tail = Math.floor(usable / 2);
  return `${text.slice(0, head).trimEnd()}${separator}${text.slice(-tail).trimStart()}`;
}

export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    // Only the actual current user turn may define the current query. Falling
    // through to an older user row would silently search the previous topic on
    // an image-only or otherwise textless turn.
    return sanitizeWebSearchQuery(messageContentToText(msg.content));
  }
  return "";
}

/**
 * Deterministic fallback used only when no contextual rewrite is available.
 * Semantic completion belongs to the query-rewrite agent; this function never
 * guesses intent from word lists or concatenates previous turns.
 */
export function buildWebSearchQuery(messages: ChatMessage[]): string {
  return extractLastUserQuery(messages);
}

/** Raw last-user text (attachment bodies NOT stripped) — for skip classification. */
export function extractLastUserRawText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    return messageContentToText(msg.content);
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

/** Structured SSE frame (not mixed into delta.content). selected first for [N] alignment. */
export function formatWebSearchSourcesSse(
  selected: WebSearchHit[],
  remainder: WebSearchHit[] = [],
): string {
  const payload = [
    ...selected.map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      usedByModel: true,
    })),
    ...remainder.map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      usedByModel: false,
    })),
  ];
  return sseDataFrame({ agenticx_web_search_sources: payload });
}

export type WebSearchTracePayload = WebSearchTrace;

/** Trace is diagnostics-only: serialization failure must never break a reply. */
export function formatWebSearchTraceSse(trace: WebSearchTracePayload): string {
  try {
    return sseDataFrame({ agenticx_web_search_trace: trace });
  } catch {
    return "";
  }
}

/**
 * @deprecated Prefer selectHitsWithinBudget + rerankHits. Thin wrapper for older tests.
 */
export function compactHitsForModel(hits: WebSearchHit[]): WebSearchHit[] {
  return selectHitsWithinBudget(hits, undefined).selected;
}

export function withSearchContext(
  messages: ChatMessage[],
  hits: WebSearchHit[],
  evidence: EvidenceFacetSummary[] = [],
): ChatMessage[] {
  const coverage = formatEvidenceCoverage(evidence);
  const resultsBlock =
    `${WEB_SEARCH_SYSTEM_HINT}${coverage ? `\n\n${coverage}` : ""}\n\n--- 联网搜索结果 ---\n${formatHits(hits)}\n--- 搜索结果结束 ---`;
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

/** Attribute selected evidence to the facet that survived global URL dedupe. */
export function summarizeSelectedEvidence(
  searchQueries: string[],
  selected: WebSearchHit[],
): EvidenceFacetSummary[] {
  return searchQueries.map((facet) =>
    summarizeEvidenceFacet(
      facet,
      selected.filter((hit) => searchQueries.length === 1 || hit.searchQuery === facet),
    ),
  );
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

export function withAssistantCapabilityContext(messages: ChatMessage[]): ChatMessage[] {
  const next = messages.map((m) => ({ ...m }));
  const block = ASSISTANT_CAPABILITY_SYSTEM_HINT.trimEnd();
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

function extractCompletionContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = message?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part && typeof part === "object"))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

async function callGatewayJson(
  deps: GatewayFetchDeps,
  body: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (deps.signal) {
    if (deps.signal.aborted) controller.abort();
    else deps.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const response = await fetchImpl(deps.url, {
      method: "POST",
      headers: {
        ...deps.headers,
        "x-agenticx-trace-stage": "chat.search-query-rewrite",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`query rewrite upstream HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("query rewrite upstream returned non-JSON");
    }
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

export type StandaloneSearchQueryResolution = SearchQueryRewrite & {
  source: "ai" | "current";
};

export type StandaloneSearchQueryOutcome =
  | { kind: "resolved"; value: StandaloneSearchQueryResolution }
  | { kind: "unresolved"; reason: "agent_unresolved" | "rewrite_unavailable" };

async function rewriteSearchQueryWithAi(
  messages: ChatMessage[],
  rewriteMessages: NonNullable<ReturnType<typeof buildSearchQueryRewriteMessages>>,
  model: string | undefined,
  deps: GatewayFetchDeps,
): Promise<StandaloneSearchQueryOutcome> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= QUERY_REWRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const retryMessages =
        attempt === 1
          ? rewriteMessages
          : rewriteMessages.map((message, index) =>
              index === 0
                ? {
                    ...message,
                    content: `${message.content}上一次输出未能解析；本次只输出一行合法 JSON。`,
                  }
                : message,
            );
      const payload = await callGatewayJson(
        deps,
        {
          ...(model ? { model } : {}),
          messages: retryMessages,
          stream: false,
          temperature: 0,
          max_tokens: QUERY_REWRITE_MAX_TOKENS,
        },
        QUERY_REWRITE_TIMEOUT_MS,
      );
      const rewrite = parseSearchQueryRewrite(extractCompletionContent(payload));
      if (
        rewrite &&
        [rewrite.query, ...rewrite.searchQueries].some(
          (query) => query && hasPriorSearchQueryLeakage(query, messages),
        )
      ) {
        throw new Error("query rewrite copied the prior question");
      }
      if (!rewrite) throw new Error("query rewrite output failed validation");
      if (!rewrite.query) {
        console.info("[web-search] contextual query rewrite explicitly unresolved");
        return { kind: "unresolved", reason: "agent_unresolved" };
      }
      console.info(
        `[web-search] contextual query rewrite confidence=${rewrite.confidence.toFixed(2)} chars=${rewrite.query.length} attempt=${attempt}`,
      );
      return { kind: "resolved", value: { ...rewrite, source: "ai" } };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[web-search] contextual query rewrite attempt ${attempt}/${QUERY_REWRITE_MAX_ATTEMPTS} failed:`,
        lastError,
      );
      if (deps.signal?.aborted) break;
    }
  }
  console.warn(
    "[web-search] contextual query rewrite unavailable; refusing raw contextual search:",
    lastError,
  );
  return { kind: "unresolved", reason: "rewrite_unavailable" };
}

/**
 * Resolve the current turn into a standalone retrieval query.
 *
 * Both normal web search and deep research must go through this function so a
 * contextual follow-up can never fall back to searching its raw pronoun or
 * ellipsis. A first user turn has no missing context and can be used verbatim.
 */
export async function resolveStandaloneSearchQuery(
  messages: WebSearchChatMessage[],
  model: string | undefined,
  deps: GatewayFetchDeps,
): Promise<StandaloneSearchQueryOutcome> {
  const rewriteMessages = buildSearchQueryRewriteMessages(messages);
  if (rewriteMessages) {
    return rewriteSearchQueryWithAi(messages, rewriteMessages, model, deps);
  }

  const query = buildWebSearchQuery(messages);
  if (!query) return { kind: "unresolved", reason: "agent_unresolved" };
  return {
    kind: "resolved",
    value: {
      query,
      needSearch: true,
      searchQueries: [query],
      confidence: 1,
      source: "current",
    },
  };
}

type PipeOptions = {
  sourcesFrame?: string;
  traceFrame?: string;
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
  const traceFrame = options.traceFrame ?? "";
  const prefixText = options.prefixText ?? "";

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "gateway error");
    const message = extractUpstreamErrorMessage(errText, upstream.status);
    // A diagnostic-only trace must never change HTTP error semantics. Preserve
    // the legacy SSE recovery only when search sources were already produced.
    if (sourcesFrame) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(sourcesFrame));
          if (traceFrame) controller.enqueue(encoder.encode(traceFrame));
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
        if (traceFrame) {
          controller.enqueue(encoder.encode(traceFrame));
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

async function pipeWithPrefix(
  upstream: Response,
  prefixText: string,
  trace?: WebSearchTracePayload,
): Promise<Response> {
  return pipeUpstreamSse(upstream, {
    prefixText,
    ...(trace ? { traceFrame: formatWebSearchTraceSse(trace) } : {}),
  });
}

async function pipeWithSourcesAppendix(
  upstream: Response,
  selected: WebSearchHit[],
  remainder: WebSearchHit[] = [],
  trace?: WebSearchTracePayload,
): Promise<Response> {
  const sourcesFrame =
    selected.length + remainder.length > 0 ? formatWebSearchSourcesSse(selected, remainder) : "";
  return pipeUpstreamSse(upstream, {
    sourcesFrame,
    ...(trace ? { traceFrame: formatWebSearchTraceSse(trace) } : {}),
  });
}

export const MAX_ORDINARY_SEARCH_PROVIDER_CALLS = 3;

function perQueryMaxResults(cfg: WebSearchRuntimeConfig, queryCount: number): number | undefined {
  if (queryCount <= 1) return undefined;
  const total = Math.max(1, Math.min(WEB_SEARCH_MAX_RESULTS_CAP, cfg.maxResults));
  return Math.max(1, Math.floor(total / queryCount));
}

async function executeOrdinarySearchPlan(
  queries: string[],
  cfg: WebSearchRuntimeConfig,
  searchFn: typeof executeWebSearch,
): Promise<{
  groups: WebSearchHit[][];
  providerCalls: number;
  providerIdsByQuery: string[][];
  retry?: NonNullable<WebSearchTracePayload["retry"]>;
}> {
  const providers = configuredWebSearchProviders(cfg);
  const primary = primaryWebSearchProvider(cfg);
  if (!primary) throw new Error("no configured web search provider");

  const alternative = selectAlternativeProvider(providers, primary.id);
  const maxResults = perQueryMaxResults(cfg, queries.length);
  let callsUsed = 0;
  let retryTrace: NonNullable<WebSearchTracePayload["retry"]> | undefined;
  const providerIdsByQuery = queries.map(() => [primary.id]);

  const groups = await Promise.all(
    queries.map(async (query) => {
      callsUsed += 1;
      try {
        return await searchFn(
          query,
          maxResults,
          configForWebSearchProvider(cfg, primary),
        );
      } catch (error) {
        console.warn(
          `[web-search] provider=${primary.id} query_chars=${query.length} failed:`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );

  // All facets share one retry budget. Two facets may consume 2+1 calls; three
  // facets already consume the complete budget and never expand to six calls.
  if (alternative && callsUsed < MAX_ORDINARY_SEARCH_PROVIDER_CALLS) {
    let retryIndex = groups.findIndex((hits) => hits.length === 0);
    if (retryIndex < 0) {
      retryIndex = groups.findIndex((hits) => assessSearchEvidence(hits).retry);
    }
    if (retryIndex >= 0) {
      const current = groups[retryIndex] ?? [];
      const quality = assessSearchEvidence(current);
      const retryReason = current.length === 0 ? "primary_failed" : "sparse_evidence";
      retryTrace = {
        used: true,
        queryIndex: retryIndex,
        reason: retryReason,
        fromProviderId: primary.id,
        toProviderId: alternative.id,
      };
      console.info(
        `[web-search] retry reason=${retryReason} from=${primary.id} to=${alternative.id} query_index=${retryIndex} uniqueUrls=${quality.uniqueUrls} uniqueHosts=${quality.uniqueHosts}`,
      );
      callsUsed += 1;
      providerIdsByQuery[retryIndex]!.push(alternative.id);
      try {
        const complement = await searchFn(
          queries[retryIndex]!,
          maxResults,
          configForWebSearchProvider(cfg, alternative),
        );
        groups[retryIndex] = current.length === 0
          ? complement
          : mergeSearchHits(current, complement);
      } catch (error) {
        console.warn(
          `[web-search] retry provider=${alternative.id} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  console.info(
    `[web-search] retrieval queries=${queries.length} provider_calls=${callsUsed}/${MAX_ORDINARY_SEARCH_PROVIDER_CALLS}`,
  );
  return {
    groups,
    providerCalls: callsUsed,
    providerIdsByQuery,
    ...(retryTrace ? { retry: retryTrace } : {}),
  };
}

export async function runWebSearchTurn(
  parsedBody: Record<string, unknown>,
  deps: GatewayFetchDeps,
): Promise<Response> {
  const baseBody = stripWebSearchFlag(parsedBody);
  // Sanitize assistant history before search/skip paths so prior <think> chains and
  // stale [N] citation indices never reach the upstream model.
  const originalMessages = sanitizeHistoryForUpstream(
    stripEmptyAssistantMessages(
      Array.isArray(baseBody.messages) ? (baseBody.messages as ChatMessage[]) : [],
    ),
  );

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const cfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);
  const { tools: _tools, tool_choice: _toolChoice, ...rest } = baseBody;

  const respondWithoutSearch = async (
    reason: string,
    details: { resolvedQuery?: string; queryResolutionMs?: number } = {},
  ): Promise<Response> => {
    console.info(`[web-search] skipped search-first (reason=${reason})`);
    const trace: WebSearchTracePayload = {
      version: 1,
      decision: "skip",
      reason,
      ...(details.resolvedQuery ? { resolvedQuery: details.resolvedQuery } : {}),
      providerCalls: 0,
      timings: {
        queryResolutionMs: Math.max(0, details.queryResolutionMs ?? 0),
        retrievalMs: 0,
      },
    };
    try {
      const directMessages =
        reason === "assistant_meta"
          ? withAssistantCapabilityContext(withCurrentTimeContext(originalMessages))
          : reason.startsWith("context_query_")
            ? withCurrentTimeContext(originalMessages)
          : withTrivialTurnContext(withCurrentTimeContext(originalMessages));
      const upstream = await callGatewayStream(deps, {
        ...rest,
        stream: true,
        messages: directMessages,
      });
      return pipeUpstreamSse(upstream, {
        traceFrame: formatWebSearchTraceSse(trace),
      });
    } catch (error) {
      return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
    }
  };

  if (!cfg.enabled) {
    try {
      const upstream = await callGatewayStream(deps, {
        ...rest,
        stream: true,
        messages: withCurrentTimeContext(originalMessages),
      });
      return pipeWithPrefix(upstream, ADMIN_DISABLED_HINT, {
        version: 1,
        decision: "skip",
        reason: "admin_disabled",
        providerCalls: 0,
        timings: { queryResolutionMs: 0, retrievalMs: 0 },
      });
    } catch (error) {
      return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
    }
  }

  // Decide whether this turn needs search from the current user text only. If it
  // does, contextual completion below is always delegated to the rewrite agent.
  const queryForSkip = extractLastUserQuery(originalMessages);
  const alwaysSearch = webSearchAlwaysOn();
  const skip = alwaysSearch
    ? null
    : classifyWebSearchNeed({
        query: queryForSkip,
        rawQuery: extractLastUserRawText(originalMessages),
      });
  if (skip?.need === "skip") {
    return respondWithoutSearch(skip.reason, { resolvedQuery: queryForSkip });
  }

  const modelName = typeof rest.model === "string" ? rest.model : undefined;
  const queryResolutionStartedAt = Date.now();
  const queryResolution = await resolveStandaloneSearchQuery(
    originalMessages,
    modelName,
    deps,
  );
  const queryResolutionMs = Date.now() - queryResolutionStartedAt;
  if (queryResolution.kind === "unresolved") {
    return respondWithoutSearch(`context_query_${queryResolution.reason}`, {
      queryResolutionMs,
    });
  }
  if (!queryResolution.value.needSearch) {
    return respondWithoutSearch("semantic_no_search", {
      resolvedQuery: queryResolution.value.query,
      queryResolutionMs,
    });
  }
  const query = queryResolution.value.query;
  const searchQueries = (
    queryResolution.value.searchQueries.length > 0
      ? queryResolution.value.searchQueries
      : [query]
  ).slice(0, MAX_ORDINARY_SEARCH_PROVIDER_CALLS);
  // Only the first user turn may search the current text verbatim. Once recent
  // context exists, provider retrieval is gated on a standalone agent rewrite.

  const searchFn = deps.executeSearch ?? executeWebSearch;
  let hits: WebSearchHit[] = [];
  let rankedGroups: WebSearchHit[][] = searchQueries.map(() => []);
  let searchFailed = false;
  let providerCalls = 0;
  let providerIdsByQuery: string[][] = searchQueries.map(() => []);
  let retryTrace: WebSearchTracePayload["retry"];
  const retrievalStartedAt = Date.now();

  if (!query) {
    searchFailed = true;
    console.warn("[web-search] search failed, degrading: missing user query for web search");
  } else {
    try {
      const planResult = await executeOrdinarySearchPlan(searchQueries, cfg, searchFn);
      providerCalls = planResult.providerCalls;
      providerIdsByQuery = planResult.providerIdsByQuery;
      retryTrace = planResult.retry;
      rankedGroups = planResult.groups.map((group, index) =>
        diversifyBySourceHost(
          rerankHits(searchQueries[index]!, group),
          (hit) => hit.url,
        ).map((hit) =>
          searchQueries.length > 1
            ? { ...hit, searchQuery: searchQueries[index]! }
            : hit,
        ),
      );
      hits = interleaveSearchHitGroups(rankedGroups).slice(0, WEB_SEARCH_MAX_RESULTS_CAP);
      searchFailed = hits.length === 0;
      if (searchFailed) {
        console.warn("[web-search] search failed, degrading: no usable hits");
      }
    } catch (error) {
      searchFailed = true;
      console.warn(
        "[web-search] search failed, degrading:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const { selected, remainder } = searchFailed
    ? { selected: [] as WebSearchHit[], remainder: [] as WebSearchHit[] }
    : selectHitsWithinBudget(hits, modelName);
  if (!searchFailed) {
    const budget = resolveInjectionBudgetChars(modelName);
    console.info(
      `[web-search] model=${modelName ?? "unknown"} budget=${budget} selected=${selected.length}/${hits.length}`,
    );
  }

  // Interleaving assigns a duplicate URL to its first facet only. Preserve that
  // ownership here so a shared page cannot make another facet look covered.
  const evidence = summarizeSelectedEvidence(searchQueries, selected);
  const traceFacetStats = searchQueries.map((facet, index) => {
    const summary = summarizeEvidenceFacet(facet, rankedGroups[index] ?? []);
    return {
      query: facet,
      ...(providerIdsByQuery[index]?.length
        ? { providerIds: providerIdsByQuery[index] }
        : {}),
      hitCount: summary.selectedHits,
      uniqueHosts: summary.uniqueHosts,
      ...(summary.dateFrom ? { dateFrom: summary.dateFrom } : {}),
      ...(summary.dateTo ? { dateTo: summary.dateTo } : {}),
    };
  });
  const trace: WebSearchTracePayload = {
    version: 1,
    decision: "search",
    reason: searchFailed
      ? "retrieval_failed"
      : alwaysSearch
        ? "always_search"
        : "automatic_search",
    resolvedQuery: query,
    facets: traceFacetStats,
    providerCalls,
    ...(retryTrace ? { retry: retryTrace } : {}),
    timings: {
      queryResolutionMs: Math.max(0, queryResolutionMs),
      retrievalMs: Math.max(0, Date.now() - retrievalStartedAt),
    },
  };

  const messages = withCurrentTimeContext(
    searchFailed ? originalMessages : withSearchContext(originalMessages, selected, evidence),
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
    return pipeWithPrefix(upstream, UNAVAILABLE_HINT, trace);
  }
  return pipeWithSourcesAppendix(upstream, selected, remainder, trace);
}
