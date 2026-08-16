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

import {
  calculationContextBlock,
  planEvidenceCalculations,
} from "../calculator/evidence-context";
import type { CalculatorResult } from "../calculator/core";
import {
  DEFAULT_CALCULATION_INTENT,
  allowsEvidencePlanning,
  type CalculationIntent,
} from "../calculator/intent";
import { withCalculatorContext } from "../calculator/chat-context";
import { stripEmptyAssistantMessages } from "../chat-completion-sanitize";
import type { PreparedSearchPlan } from "../chat-routing/turn-plan";
import { withCurrentTimeContext } from "../current-time";
import {
  PORTAL_CAPABILITY_SYSTEM_HINT,
  withPortalCapabilityContext,
} from "../portal-capabilities";
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
  canSafelyFallbackToCurrentQuery,
  hasPriorSearchQueryLeakage,
  parseSearchQueryRewrite,
  type SearchQueryRewriteOptions,
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
  type WebSearchExecutionDiagnostics,
  type WebSearchHit,
  type WebSearchRuntimeConfig,
} from "./providers";
import { isTenantDailySearchProviderQuotaExceeded } from "./daily-provider-quota";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "./config";
import { isCalculatorEnabled } from "./tenant-config";
import { rerankHits } from "./rerank";
import {
  assessSearchEvidence,
  interleaveSearchHitGroups,
  mergeSearchHits,
  selectAlternativeProvider,
} from "./search-retry";
import {
  DEFAULT_MAX_SEARCH_CALLS,
  normalizeMaxSearchCalls,
} from "./search-call-budget";
import { classifyWebSearchFastPath } from "./search-necessity";
import {
  DIRECT_PAGE_CONTEXT_CHARS,
  directPageSource,
  matchesDirectPage,
  readDirectPage,
  replaceCurrentQuestion,
  resolveDirectPageReference,
  selectDirectPageEvidence,
  withDirectPageContext,
} from "./direct-page";
import type { PageFetchFailure } from "./page-fetch";
import {
  isPortalAttachmentOnlyTurn,
  MAX_WEB_SEARCH_QUERY_CHARS,
  messageContentToText,
  sanitizeResearchRequest,
  sanitizeWebSearchQuery,
} from "./query-text";

export {
  isPortalAttachmentOnlyTurn,
  MAX_WEB_SEARCH_QUERY_CHARS,
  messageContentToText,
  sanitizeResearchRequest,
  sanitizeWebSearchQuery,
} from "./query-text";

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

/** @deprecated Use PORTAL_CAPABILITY_SYSTEM_HINT for the shared capability registry. */
export const ASSISTANT_CAPABILITY_SYSTEM_HINT = PORTAL_CAPABILITY_SYSTEM_HINT;

const TRIVIAL_TURN_MARKER = "## 本轮说明";

/** @deprecated Kept for tests / compatibility; search-first path does not probe tools. */
export const WEB_SEARCH_TOOL_CHOICE = {
  type: "function",
  function: { name: "web_search" },
} as const;

const ADMIN_DISABLED_HINT = "> 管理员已关闭联网搜索。\n\n";
const UNAVAILABLE_HINT = "> 联网搜索暂不可用，以下回答基于模型已有知识。\n\n";
const INCOMPLETE_DIRECT_PAGE_HINT =
  "> 该页面可能依赖动态渲染或限制自动访问，正文未完整读取；当前回答未使用该页完整正文。\n\n";
const INCOMPLETE_DIRECT_PAGE_SYSTEM_HINT =
  "## 本轮链接读取状态\n" +
  "用户指定页面的正文未能完整提取，可能依赖动态渲染或限制自动访问。" +
  "不得声称已打开、通读或直接读取该页面；若下方存在搜索结果，只能基于这些结果作答，证据不足时必须明确说明。";
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
  /**
   * Tenant daily provider-call gate, awaited immediately before every real
   * outbound search (primary and failover alike). Rejecting aborts the turn.
   */
  reserveProviderCall?: () => Promise<void>;
  /** Test seam; production reuses page-fetch through readDirectPage. */
  readPage?: typeof readDirectPage;
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

const FAST_SKIP_BYPASS_ENV = "AGENTICX_WEB_SEARCH_BYPASS_FAST_SKIP";
const LEGACY_FAST_SKIP_BYPASS_ENV = "AGENTICX_WEB_SEARCH_ALWAYS";
let warnedAboutProductionFastSkipBypass = false;

function isEnabledEnvironmentFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Operations escape hatch for bypassing only the deterministic no-search gate.
 * Contextual turns still use the semantic query resolver, which may decline to
 * search. The old ALWAYS name remains compatible but never meant "force".
 */
function webSearchFastSkipBypassed(): boolean {
  const configuredBy = isEnabledEnvironmentFlag(FAST_SKIP_BYPASS_ENV)
    ? FAST_SKIP_BYPASS_ENV
    : isEnabledEnvironmentFlag(LEGACY_FAST_SKIP_BYPASS_ENV)
      ? LEGACY_FAST_SKIP_BYPASS_ENV
      : "";
  if (!configuredBy) return false;

  if (
    process.env.NODE_ENV === "production" &&
    !warnedAboutProductionFastSkipBypass
  ) {
    warnedAboutProductionFastSkipBypass = true;
    const legacyNotice = configuredBy === LEGACY_FAST_SKIP_BYPASS_ENV
      ? `; migrate to ${FAST_SKIP_BYPASS_ENV}`
      : "";
    console.warn(
      `[web-search] ${configuredBy} is enabled in production${legacyNotice}; ` +
        "the deterministic fast-skip gate is bypassed, but contextual query resolution still applies",
    );
  }
  return true;
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

/** How far back an operand may be anchored to something the user typed. */
const MAX_CALCULATION_ANCHOR_MESSAGES = 8;
const MAX_CALCULATION_TASK_TURN_CHARS = 600;

/**
 * What the calculation planner is told the turn is about.
 *
 * The resolved query alone is not enough and cannot be: it is built to be a
 * short retrieval term, so "查一下最新股价和 EPS，帮我算出 PE" reaches search
 * as "公司 最新股价 EPS" and the instruction to compute is exactly the part
 * that was compressed away. The verbatim request and the recent turns carry it.
 */
function calculationTask(messages: ChatMessage[], resolvedQuery: string): string {
  const request = extractLastUserRawText(messages).slice(
    0,
    MAX_CALCULATION_TASK_TURN_CHARS,
  );
  const history = recentTurnTexts(messages)
    .slice(0, -1)
    .map((text) => text.slice(0, MAX_CALCULATION_TASK_TURN_CHARS))
    .filter((text) => text.trim());
  return [
    `用户当前请求：${request}`,
    resolvedQuery ? `本轮检索词：${resolvedQuery}` : "",
    history.length ? `最近对话：\n${history.join("\n---\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Recent human/assistant text, so an operand the user supplied also anchors. */
export function recentTurnTexts(messages: ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_CALCULATION_ANCHOR_MESSAGES)
    .map((message) => messageContentToText(message.content));
}

/**
 * Prepend locally computed figures to the grounded system message.
 *
 * Placed before the search results rather than after: the model must reach the
 * instruction not to recompute them before it reaches the numbers they came
 * from. An empty batch — nothing to compute, or planning failed — returns the
 * messages untouched, which is why the answer path needs no branch of its own.
 */
export function withEvidenceCalculations(
  messages: ChatMessage[],
  results: readonly CalculatorResult[],
): ChatMessage[] {
  if (results.length === 0) return messages;
  const block = calculationContextBlock(results);
  const next = messages.map((message) => ({ ...message }));
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

function withIncompleteDirectPageContext(messages: ChatMessage[]): ChatMessage[] {
  const next = messages.map((message) => ({ ...message }));
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing
        ? `${existing}\n\n${INCOMPLETE_DIRECT_PAGE_SYSTEM_HINT}`
        : INCOMPLETE_DIRECT_PAGE_SYSTEM_HINT,
    };
    return next;
  }
  return [
    { role: "system", content: INCOMPLETE_DIRECT_PAGE_SYSTEM_HINT },
    ...next,
  ];
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
  return withPortalCapabilityContext(messages);
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
  /** `current-fallback`: rewriter unreachable, self-contained question reused once. */
  source: "ai" | "current" | "auto-route" | "current-fallback";
};

export type StandaloneSearchQueryOutcome =
  | { kind: "resolved"; value: StandaloneSearchQueryResolution }
  | { kind: "unresolved"; reason: "agent_unresolved" | "rewrite_unavailable" };

async function rewriteSearchQueryWithAi(
  messages: ChatMessage[],
  rewriteMessages: NonNullable<ReturnType<typeof buildSearchQueryRewriteMessages>>,
  model: string | undefined,
  deps: GatewayFetchDeps,
  maxSearchCalls: number,
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
      const rewrite = parseSearchQueryRewrite(
        extractCompletionContent(payload),
        maxSearchCalls,
      );
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

  // Reaching here means the rewriter was *unreachable* (timeout / HTTP / parse),
  // which is different from the model deciding the turn is unresolvable — that
  // case returned agent_unresolved above and never searches.
  if (!deps.signal?.aborted) {
    const current = sanitizeWebSearchQuery(buildWebSearchQuery(messages));
    if (current && canSafelyFallbackToCurrentQuery(current)) {
      console.info(
        `[web-search] query rewrite unavailable; searching the self-contained current question once chars=${current.length}`,
      );
      return {
        kind: "resolved",
        value: {
          query: current,
          needSearch: true,
          // One query, no facet split, no history concatenation.
          searchQueries: [current],
          confidence: 0.5,
          source: "current-fallback",
          // The rewriter was unreachable, so its hint is unavailable too.
          calculationIntent: DEFAULT_CALCULATION_INTENT,
        },
      };
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
  maxSearchCallsValue: unknown = DEFAULT_MAX_SEARCH_CALLS,
  rewriteOptions: SearchQueryRewriteOptions = {},
): Promise<StandaloneSearchQueryOutcome> {
  const maxSearchCalls = normalizeMaxSearchCalls(maxSearchCallsValue);
  const rewriteMessages = buildSearchQueryRewriteMessages(
    messages,
    new Date(),
    maxSearchCalls,
    rewriteOptions,
  );
  if (rewriteMessages) {
    return rewriteSearchQueryWithAi(
      messages,
      rewriteMessages,
      model,
      deps,
      maxSearchCalls,
    );
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
      // The rewrite agent was skipped, so nothing judged this turn.
      calculationIntent: DEFAULT_CALCULATION_INTENT,
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
  prefixText = "",
): Promise<Response> {
  const sourcesFrame =
    selected.length + remainder.length > 0 ? formatWebSearchSourcesSse(selected, remainder) : "";
  return pipeUpstreamSse(upstream, {
    sourcesFrame,
    ...(prefixText ? { prefixText } : {}),
    ...(trace ? { traceFrame: formatWebSearchTraceSse(trace) } : {}),
  });
}

function perQueryMaxResults(cfg: WebSearchRuntimeConfig, queryCount: number): number | undefined {
  if (queryCount <= 1) return undefined;
  const total = Math.max(1, Math.min(WEB_SEARCH_MAX_RESULTS_CAP, cfg.maxResults));
  return Math.max(1, Math.floor(total / queryCount));
}

async function executeOrdinarySearchPlan(
  queries: string[],
  cfg: WebSearchRuntimeConfig,
  searchFn: typeof executeWebSearch,
  options: {
    acceptHit?: (hit: WebSearchHit) => boolean;
    reserveProviderCall?: () => Promise<void>;
  } = {},
): Promise<{
  groups: WebSearchHit[][];
  providerCalls: number;
  providerIdsByQuery: string[][];
  retry?: NonNullable<WebSearchTracePayload["retry"]>;
}> {
  const maxSearchCalls = normalizeMaxSearchCalls(cfg.maxSearchCalls);
  const boundedQueries = queries.slice(0, maxSearchCalls);
  const providers = configuredWebSearchProviders(cfg);
  const primary = primaryWebSearchProvider(cfg);
  if (!primary) throw new Error("no configured web search provider");

  const alternative = selectAlternativeProvider(providers, primary.id);
  const maxResults = perQueryMaxResults(cfg, boundedQueries.length);
  let callsUsed = 0;
  let retryTrace: NonNullable<WebSearchTracePayload["retry"]> | undefined;
  const providerIdsByQuery = boundedQueries.map(() => [primary.id]);
  const admission: WebSearchExecutionDiagnostics | undefined = options.reserveProviderCall
    ? { beforeProviderAttempt: () => options.reserveProviderCall!() }
    : undefined;

  const groups = await Promise.all(
    boundedQueries.map(async (query) => {
      callsUsed += 1;
      try {
        const hits = await searchFn(
          query,
          maxResults,
          configForWebSearchProvider(cfg, primary),
          undefined,
          admission,
        );
        return options.acceptHit ? hits.filter(options.acceptHit) : hits;
      } catch (error) {
        // A tenant quota block is not a provider fault: stop, do not degrade to
        // an unsearched answer and do not spend the failover call.
        if (isTenantDailySearchProviderQuotaExceeded(error)) throw error;
        console.warn(
          `[web-search] provider=${primary.id} query_chars=${query.length} failed:`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );

  // All facets and the single evidence-quality retry share one provider-call
  // budget. A plan that consumes the cap cannot expand into per-facet retries.
  if (alternative && callsUsed < maxSearchCalls) {
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
        const fetched = await searchFn(
          boundedQueries[retryIndex]!,
          maxResults,
          configForWebSearchProvider(cfg, alternative),
          undefined,
          admission,
        );
        const complement = options.acceptHit ? fetched.filter(options.acceptHit) : fetched;
        groups[retryIndex] = current.length === 0
          ? complement
          : mergeSearchHits(current, complement);
      } catch (error) {
        if (isTenantDailySearchProviderQuotaExceeded(error)) throw error;
        console.warn(
          `[web-search] retry provider=${alternative.id} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  console.info(
    `[web-search] retrieval queries=${boundedQueries.length} provider_calls=${callsUsed}/${maxSearchCalls}`,
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
  options: { preparedSearchPlan?: PreparedSearchPlan } = {},
): Promise<Response> {
  const baseBody = stripWebSearchFlag(parsedBody);
  // Sanitize assistant history before search/skip paths so prior <think> chains and
  // stale [N] citation indices never reach the upstream model.
  const originalMessages = withPortalCapabilityContext(
    sanitizeHistoryForUpstream(
      stripEmptyAssistantMessages(
        Array.isArray(baseBody.messages) ? (baseBody.messages as ChatMessage[]) : [],
      ),
    ),
  );

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const cfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);
  // One read, already done for search policy. Off means this turn never enters
  // the calculation path at all — no planning call, no hint in any prompt, and
  // an upstream request identical to the one sent before the calculator
  // existed.
  const calculatorEnabled = isCalculatorEnabled(tenant);
  const { tools: _tools, tool_choice: _toolChoice, ...rest } = baseBody;

  /**
   * The body for an answer this turn will produce with no evidence attached.
   *
   * Four branches reach that state — the fast skip, an agent deciding no search
   * is needed, search disabled by an administrator, and retrieval failing — and
   * each used to stream straight to the model. So "1+2" with the web search
   * toggle ON was answered from the model's head, while the same question with
   * the toggle OFF was computed. Wiring these one at a time is how that gap
   * happened twice, so they now share this.
   *
   * `intent` is passed where a routing agent already judged the turn. It can
   * only open a calculation the pattern missed; it can never veto one. When no
   * calculation is planned this adds no call at all.
   */
  const prepareNoEvidenceAnswerBody = async (
    messages: ChatMessage[],
    intent?: CalculationIntent,
  ): Promise<Record<string, unknown>> => {
    const body: Record<string, unknown> = { ...rest, stream: true, messages };
    if (!calculatorEnabled) return body;
    const calculated = await withCalculatorContext(
      body,
      deps,
      intent ? { intent } : {},
    );
    return calculated ?? body;
  };

  const respondWithoutSearch = async (
    reason: string,
    details: {
      resolvedQuery?: string;
      queryResolutionMs?: number;
      calculationIntent?: CalculationIntent;
    } = {},
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
      const upstream = await callGatewayStream(
        deps,
        await prepareNoEvidenceAnswerBody(directMessages, details.calculationIntent),
      );
      return pipeUpstreamSse(upstream, {
        traceFrame: formatWebSearchTraceSse(trace),
      });
    } catch (error) {
      return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
    }
  };

  if (!cfg.enabled) {
    try {
      const upstream = await callGatewayStream(
        deps,
        await prepareNoEvidenceAnswerBody(withCurrentTimeContext(originalMessages)),
      );
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

  const directReference = resolveDirectPageReference(originalMessages);
  const queryMessages = directReference?.explicitInCurrentTurn
    ? replaceCurrentQuestion(
        originalMessages,
        directReference.question || directReference.displayUrl,
      )
    : originalMessages;

  // Decide whether this turn needs search from the current user text only. If it
  // does, contextual completion below is always delegated to the rewrite agent.
  const queryForSkip = extractLastUserQuery(queryMessages);
  const fastSkipBypassed = webSearchFastSkipBypassed();
  const fastPath = fastSkipBypassed || directReference?.explicitInCurrentTurn
    ? null
    : classifyWebSearchFastPath({
        query: queryForSkip,
        rawQuery: extractLastUserRawText(queryMessages),
      });
  if (fastPath?.action === "skip") {
    return respondWithoutSearch(fastPath.reason, { resolvedQuery: queryForSkip });
  }

  const modelName = typeof rest.model === "string" ? rest.model : undefined;
  const directReadStartedAt = Date.now();
  let directReadFailure: PageFetchFailure | undefined;
  const directView = directReference
    ? await (deps.readPage ?? readDirectPage)(directReference, {
        signal: deps.signal,
        onFailure: (reason) => {
          directReadFailure = reason;
        },
      }).catch((error) => {
        console.warn(
          "[web-search] direct page read failed:",
          error instanceof Error ? error.message : error,
        );
        return null;
      })
    : null;
  const directReadMs = Date.now() - directReadStartedAt;
  const incompleteDirectPage = Boolean(
    directReference?.explicitInCurrentTurn &&
      !directView &&
      directReadFailure === "too_short",
  );

  const respondFromDirectPage = async (
    evidenceQueries: string[],
    resolvedQuery: string,
    queryResolutionMs: number,
    calculationIntent: CalculationIntent,
  ): Promise<Response | null> => {
    if (!directReference || !directView) return null;
    const evidence = selectDirectPageEvidence(
      directView,
      evidenceQueries
        .map((value) => value.trim())
        .filter((value, index, all) => value && all.indexOf(value) === index),
      Math.min(DIRECT_PAGE_CONTEXT_CHARS, resolveInjectionBudgetChars(modelName)),
    );
    // An explicit URL always gets a bounded preview. A historical URL is used
    // only when generic passage retrieval found supporting text; otherwise the
    // contextual rewrite and ordinary search lanes remain available.
    if (!directReference.explicitInCurrentTurn && !evidence.strongMatch) return null;

    const source = directPageSource(evidence);
    const trace: WebSearchTracePayload = {
      version: 1,
      decision: "search",
      reason:
        evidence.coverage === "abstract_only"
          ? "direct_page_abstract_only"
          : "direct_page_html",
      resolvedQuery,
      facets: [
        {
          query: resolvedQuery || directReference.displayUrl,
          providerIds: ["direct-page"],
          hitCount: 1,
          uniqueHosts: 1,
        },
      ],
      providerCalls: 0,
      timings: {
        queryResolutionMs: Math.max(0, queryResolutionMs),
        retrievalMs: Math.max(0, directReadMs),
      },
    };
    try {
      // A page the user named is evidence like any other. Reporting this path
      // as covered while it returned before reaching the planner was wrong:
      // "打开这个财报页，算一下净利率" got the same mental arithmetic as before.
      const calculations = calculatorEnabled && allowsEvidencePlanning(calculationIntent)
        ? await planEvidenceCalculations({
            deps,
            body: rest,
            task: calculationTask(originalMessages, resolvedQuery),
            evidenceText: evidence.text,
            anchorTexts: [
              `${evidence.title}\n${evidence.text}`,
              ...recentTurnTexts(originalMessages),
            ],
          })
        : [];
      const upstream = await callGatewayStream(deps, {
        ...rest,
        stream: true,
        messages: withCurrentTimeContext(
          withEvidenceCalculations(
            withDirectPageContext(originalMessages, evidence),
            calculations,
          ),
        ),
      });
      return pipeWithSourcesAppendix(upstream, [source], [], trace);
    } catch (error) {
      return gatewayUnavailableResponse(
        error instanceof Error ? error.message : "gateway unreachable",
      );
    }
  };

  if (directReference) {
    const directQuery = directReference.question || directReference.displayUrl;
    const directResponse = await respondFromDirectPage(
      [directQuery],
      directQuery,
      0,
      options.preparedSearchPlan?.calculationIntent ?? DEFAULT_CALCULATION_INTENT,
    );
    if (directResponse) return directResponse;
  }

  const queryResolutionStartedAt = Date.now();
  const explicitQuery = directReference?.explicitInCurrentTurn
    ? directReference.question || directReference.displayUrl
    : "";
  let queryResolution: StandaloneSearchQueryOutcome;
  if (directReference?.explicitInCurrentTurn) {
    queryResolution = {
      kind: "resolved",
      value: {
        query: explicitQuery,
        needSearch: true,
        searchQueries: [explicitQuery],
        confidence: 1,
        source: "current",
        // No routing agent spoke for this turn; the page may still hold figures.
        calculationIntent: DEFAULT_CALCULATION_INTENT,
      },
    };
  } else if (options.preparedSearchPlan) {
    queryResolution = {
      kind: "resolved",
      value: {
        query: options.preparedSearchPlan.query,
        needSearch: true,
        searchQueries: [...options.preparedSearchPlan.searchQueries],
        confidence: options.preparedSearchPlan.confidence,
        source: options.preparedSearchPlan.source,
        calculationIntent: options.preparedSearchPlan.calculationIntent,
      },
    };
  } else {
    queryResolution = await resolveStandaloneSearchQuery(
      queryMessages,
      modelName,
      deps,
      cfg.maxSearchCalls,
      directReference && directView
        ? {
            calculatorEnabled,
            targetDocument: {
              title: directView.title,
              url: directReference.displayUrl,
              sample: directView.text.slice(0, 2_000),
            },
          }
        : { calculatorEnabled },
    );
  }
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
      calculationIntent: queryResolution.value.calculationIntent,
    });
  }
  let query = queryResolution.value.query;
  let searchQueries = (
    queryResolution.value.searchQueries.length > 0
      ? queryResolution.value.searchQueries
      : [query]
  ).slice(0, normalizeMaxSearchCalls(cfg.maxSearchCalls));
  // Only the first user turn may search the current text verbatim. Once recent
  // context exists, provider retrieval is gated on a standalone agent rewrite.

  if (directReference && directView) {
    const directResponse = await respondFromDirectPage(
      [directReference.question, query, ...searchQueries],
      query,
      queryResolutionMs,
      queryResolution.value.calculationIntent,
    );
    if (directResponse) return directResponse;
  }

  if (directReference?.explicitInCurrentTurn && directReference.arxivId) {
    query = `arXiv ${directReference.arxivId}`;
    searchQueries = [query];
  }

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
      const exactDocumentFallback =
        directReference?.explicitInCurrentTurn && directReference.arxivId
          ? (hit: WebSearchHit) => matchesDirectPage(directReference, hit.url)
          : undefined;
      const planResult = await executeOrdinarySearchPlan(searchQueries, cfg, searchFn, {
        ...(exactDocumentFallback ? { acceptHit: exactDocumentFallback } : {}),
        ...(deps.reserveProviderCall ? { reserveProviderCall: deps.reserveProviderCall } : {}),
      });
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
      // Never degrade a quota block into a search-free answer — the caller turns
      // this into a 429 so the user knows why the web was not consulted.
      if (isTenantDailySearchProviderQuotaExceeded(error)) throw error;
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
      : fastSkipBypassed
        ? "fast_skip_bypassed"
        : queryResolution.value.source === "auto-route"
          ? "auto_route_search"
          : queryResolution.value.source === "current-fallback"
            ? "rewrite_fallback_search"
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

  // Only an explicit `not_needed` from a routing agent that already read this
  // turn skips the planning call. Silence, an older gateway, an unparseable
  // value or an honest `uncertain` all plan: the agents run before retrieval,
  // so "does this need arithmetic" is often not answerable until the pages are
  // in hand. A missed hint costs one call; a wrongly trusted one costs the
  // grounding this whole path exists for.
  const calculationIntent = queryResolution.value.calculationIntent;
  const planCalculationsForTurn =
    calculatorEnabled && !searchFailed && allowsEvidencePlanning(calculationIntent);
  if (!planCalculationsForTurn) {
    console.info(`[web-search] evidence calculation skipped intent=${calculationIntent}`);
  }

  const groundedMessages = searchFailed
    ? originalMessages
    : withEvidenceCalculations(
        withSearchContext(originalMessages, selected, evidence),
        !planCalculationsForTurn
          ? []
          : await planEvidenceCalculations({
          deps,
          body: rest,
          task: calculationTask(originalMessages, query),
          // The planner reads the hits exactly as the answering model will.
          evidenceText: formatHits(selected),
          // Operands may only come from what a source actually said, plus what
          // the user typed — not from the indices and URLs printed around them.
              anchorTexts: [
                ...selected.map((hit) => `${hit.title}\n${hit.snippet}`),
                ...recentTurnTexts(originalMessages),
              ],
            }),
      );
  const messages = withCurrentTimeContext(
    incompleteDirectPage
      ? withIncompleteDirectPageContext(groundedMessages)
      : groundedMessages,
  );

  let upstream: Response;
  try {
    upstream = await callGatewayStream(
      deps,
      searchFailed
        ? // No evidence to compute over, but the user may have supplied the
          // numbers themselves; that answer should not degrade to mental math
          // just because retrieval broke.
          await prepareNoEvidenceAnswerBody(messages, calculationIntent)
        : { ...rest, stream: true, messages },
    );
  } catch (error) {
    return gatewayUnavailableResponse(error instanceof Error ? error.message : "gateway unreachable");
  }

  if (searchFailed) {
    return pipeWithPrefix(
      upstream,
      `${incompleteDirectPage ? INCOMPLETE_DIRECT_PAGE_HINT : ""}${UNAVAILABLE_HINT}`,
      trace,
    );
  }
  return pipeWithSourcesAppendix(
    upstream,
    selected,
    remainder,
    trace,
    incompleteDirectPage ? INCOMPLETE_DIRECT_PAGE_HINT : "",
  );
}
