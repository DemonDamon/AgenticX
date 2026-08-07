/**
 * Deep research workbench: clarify → plan → parallel lanes → synthesize → sources SSE.
 */

import { ulid } from "ulid";
import {
  executeWebSearch,
  type WebSearchHit,
  type WebSearchRuntimeConfig,
} from "../web-search/providers";
import {
  resolvePageFetchConfig,
  resolveWebSearchConfig,
  type TenantWebSearchRow,
} from "../web-search/config";
import { formatWebSearchSourcesSse } from "../web-search/tool-loop";
import {
  fetchPagesBatch,
  PAGE_FETCH_TIMEOUT_MS,
  summarizeFetchFailures,
} from "../web-search/page-fetch";
import { directFetch } from "../web-search/direct-fetch";
import { probeEgress } from "../web-search/egress-probe";
import { archivePage, pageArchivePath } from "./page-archive";
import { buildCompletionSummary, fallbackSummary } from "./completion-summary";
import { buildResearchPlan, enforcePlanBreadth, type ResearchPlan } from "./planner";
import { formatTodayLine, runRecon, type ReconResult } from "./recon";
import { CitationRegistry, type Citation } from "./registry";
import { formatDeepResearchEventSse } from "./events";
import { stripThinkBlocks } from "./content-clean";
import {
  proposeClarification,
  type ClarifierResult,
  type ClarifyQuestion,
} from "./clarifier";
import {
  DEFAULT_DELIVERY_PREFS,
  deliveryClarifyQuestions,
  deliveryPrefsPromptBlock,
  isDeliveryClarifyQuestionId,
  parseDeliveryPrefs,
  primaryArtifactTitle,
  sanitizeResearchTopic,
  type DeliveryPrefs,
} from "./delivery-prefs";
import { looksOpenEndedResearchQuery } from "./research-intent";
import {
  waitForClarifyResume,
  type ClarifyResumePayload,
} from "./run-wait";
import {
  createArtifactStore,
  type ArtifactStore,
  MAX_ARTIFACTS_PER_RUN,
} from "./artifact-store";
import {
  defaultRunStore,
  createRunWriter,
  type DeepResearchRunStatus,
  type RunStore,
  type RunWriter,
} from "./run-store";
import {
  buildReportOutline,
  buildSectionMessages,
  linkifyCitations,
  renderTableOfContents,
  sectionMeetsFormat,
} from "./report-writer";
import { finalizeReportArtifacts } from "./finalize-report-artifacts";
import {
  refreshGatewayBearer,
  type RefreshAccessToken,
} from "./gateway-auth-refresh";
import { expandQueries, type QueryVariant } from "./query-expander";
import {
  SourcePool,
  scorePool,
  selectTopSources,
} from "./source-pool";
import { reflectOnGaps, type ResearchGap } from "./reflector";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";

export const SEARCH_CONCURRENCY = 3;
/** Default per-lane result count; the live path uses resolveResultsPerLane(). */
export const RESULTS_PER_QUESTION = 5;
export const MAX_SOURCES = 40;
export const MAX_LANES = 8;
export const MIN_RESULTS_PER_LANE = 4;
export const MAX_RESULTS_PER_LANE = 10;
export const RECON_TIMEOUT_MS = 15_000;

function envMs(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** route.ts maxDuration = 1500s；留 300s 给收尾与网络抖动。 */
export const TOTAL_BUDGET_MS = envMs("DEEP_RESEARCH_TOTAL_BUDGET_MS", 1_200_000);
/** 车道内抓正文的时间上限，超出则该车道剩余来源只保留 snippet。 */
export const FETCH_BUDGET_MS = envMs("DEEP_RESEARCH_FETCH_BUDGET_MS", 180_000);
/** 低于此预算则跳过反思补搜，直接进综述。 */
export const REFLECT_MIN_BUDGET_MS = 150_000;
/**
 * 写作阶段最低保留预算：检索/反思一旦触及该线就收尾，把剩余时间留给分节写作，
 * 否则大纲会被写到一半就触发「因时间预算截断」。
 */
export const WRITE_RESERVE_MIN_MS = 240_000;
/** Default wait for clarify answers before continuing with skip/defaults. */
export const CLARIFY_TIMEOUT_MS = 300_000;
/** Max wait for the optional clarifier LLM call (not the user resume wait). */
export const CLARIFIER_LLM_TIMEOUT_MS = 20_000;

export const DEEP_RESEARCH_DISABLED_HINT = "> 管理员未开启深度研究，以下为普通回答。\n\n";
export const DEEP_RESEARCH_SEARCH_DISABLED_HINT =
  "> 管理员未开启联网搜索，深度研究不可用，以下为普通回答。\n\n";
export const DEEP_RESEARCH_SEARCH_FAILED =
  "> 深度研究检索失败，请稍后重试或改用普通对话。";
/** 检索已成功、终稿已落盘，但 HTML/摘要等收尾步骤失败时的文案（勿误报成检索失败）。 */
export const DEEP_RESEARCH_WRAPUP_DEGRADED =
  "> 完整报告已生成并可下载；部分收尾步骤未成功，摘要为系统兜底。";

const LANE_SUMMARY_SYSTEM =
  "你是调研备忘助手。根据检索摘录写一段简洁 Markdown 备忘（≤400 字），保留关键事实与 [N] 引用。只输出正文。";

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

export type DeepResearchDeps = {
  url: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  loadTenantConfig?: () => Promise<TenantWebSearchRow>;
  executeSearch?: typeof executeWebSearch;
  buildPlan?: typeof buildResearchPlan;
  proposeClarify?: typeof proposeClarification;
  runReconFn?: typeof runRecon;
  fetchPagesFn?: typeof fetchPagesBatch;
  expandQueriesFn?: typeof expandQueries;
  reflectFn?: typeof reflectOnGaps;
  /** Optional injected egress probe (tests). */
  probeEgressFn?: typeof probeEgress;
  artifactStore?: ArtifactStore;
  /** Optional injected run store (tests / custom backends). */
  runStore?: RunStore;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
  clarifyTimeoutMs?: number;
  /** Skip clarify wait (tests). When false and clarifier needed, still emits clarify then continues with skip. */
  awaitClarify?: boolean;
  signal?: AbortSignal;
  now?: () => number;
  /**
   * Optional: mint a fresh access JWT before synthesize (outline + sections).
   * Long retrieve can outlive the 1h cookie captured at request start.
   */
  refreshAccessToken?: RefreshAccessToken;
};

type LaneResult = {
  question: string;
  citations: Citation[];
  memo: string;
  queriesPlanned: number;
  urlsDiscovered: number;
  sourcesSelected: number;
  pagesFetched: number;
};

function sseDataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDelta(content: string): string {
  return sseDataFrame({ choices: [{ delta: { content } }] });
}

function eventStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  return "";
}

function stripFlags<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const {
    agenticx_web_search: _ws,
    agenticx_deep_research: _dr,
    tools: _tools,
    tool_choice: _tc,
    ...rest
  } = body as T & {
    agenticx_web_search?: unknown;
    agenticx_deep_research?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
  };
  return rest;
}

function slugifyLane(title: string, index: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `q${index + 1}-${base || "lane"}`;
}

/** Spread the global source budget across however many lanes the planner chose. */
export function resolveResultsPerLane(laneCount: number): number {
  if (laneCount <= 0) return MIN_RESULTS_PER_LANE;
  const even = Math.ceil(MAX_SOURCES / laneCount);
  return Math.min(MAX_RESULTS_PER_LANE, Math.max(MIN_RESULTS_PER_LANE, even));
}

export function formatEvidencePack(
  plan: ResearchPlan,
  citationsByQuestion: Array<{ question: string; citations: Citation[]; memo?: string }>,
  background: Citation[] = [],
): string {
  const parts = [`研究主题：${plan.topic}`, ""];
  if (background.length > 0) {
    parts.push("## 背景侦查（开题冷启动检索）");
    for (const c of background) {
      parts.push(`[${c.index}] ${c.title}`);
      parts.push(`URL: ${c.url}`);
      parts.push(`摘要：${c.snippet}`);
      parts.push("");
    }
  }
  citationsByQuestion.forEach((item, idx) => {
    parts.push(`## 子问题 ${idx + 1}：${item.question}`);
    if (item.memo?.trim()) {
      parts.push("### 车道备忘");
      parts.push(item.memo.trim());
      parts.push("");
    }
    if (item.citations.length === 0) {
      parts.push("（无可用来源）");
      parts.push("");
      return;
    }
    for (const c of item.citations) {
      parts.push(`[${c.index}] ${c.title}`);
      parts.push(`URL: ${c.url}`);
      const body = c.fullText ? `正文节选：${c.fullText}` : `摘要：${c.snippet}`;
      parts.push(body);
      parts.push("");
    }
  });
  return parts.join("\n").trim();
}

/** Kept for unit tests / legacy callers; main path no longer appends this to content. */
export function formatSourcesAppendix(citations: Citation[]): string {
  if (citations.length === 0) return "";
  // HTML anchors for [N](#ref-N) jump targets (chat path does not append this block).
  const lines = citations.map(
    (c) => `<a id="ref-${c.index}"></a>[${c.index}] ${c.title} — ${c.url}`,
  );
  return `\n\n---\n**来源**\n${lines.join("\n")}\n`;
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () =>
    runOne(),
  );
  await Promise.all(runners);
  return results;
}

async function callGatewayStream(
  deps: DeepResearchDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return fetchImpl(deps.url, {
    method: "POST",
    headers: deps.headers,
    body: JSON.stringify(body),
    signal: deps.signal,
  });
}

async function callGatewayJson(
  deps: DeepResearchDeps,
  body: Record<string, unknown>,
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(deps.url, {
    method: "POST",
    headers: deps.headers,
    body: JSON.stringify({ ...body, stream: false }),
    signal: deps.signal,
  });
  if (!response.ok) return "";
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

async function pipeWithPrefix(upstream: Response, prefixText: string): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "gateway error");
    return new Response(errText, {
      status: upstream.status || 502,
      headers: { "content-type": "application/json" },
    });
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(sseDelta(prefixText)));
      const reader = upstream.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) controller.enqueue(value);
      }
      try {
        controller.close();
      } catch {
        // client may have cancelled the body first
      }
    },
  });
  return eventStreamResponse(stream);
}

function textOnlyDoneStream(content: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      if (content) controller.enqueue(encoder.encode(sseDelta(content)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      try {
        controller.close();
      } catch {
        // client may have cancelled the body first
      }
    },
  });
  return eventStreamResponse(stream);
}

function citationsToHits(citations: Citation[]): WebSearchHit[] {
  return citations.map((c) => ({ title: c.title, url: c.url, snippet: c.snippet }));
}

function applyClarifyAnswers(
  userQuery: string,
  questions: ClarifyQuestion[],
  resume: ClarifyResumePayload,
): string {
  if (resume.skip || questions.length === 0) return userQuery;
  const lines = questions.map((q) => {
    const answer = resume.answers[q.id]?.trim();
    return answer ? `- ${q.question}: ${answer}` : null;
  }).filter(Boolean);
  if (lines.length === 0) return userQuery;
  return `${userQuery}\n\n【用户澄清】\n${lines.join("\n")}`;
}

/**
 * Recover the option labels a user multi-selected from the joined answer string.
 * Longest-label-first avoids false splits when a label itself contains "、".
 */
export function matchSelectedOptions(
  answer: string,
  options: Array<{ id: string; label: string }>,
): string[] {
  const text = answer.trim();
  if (!text || options.length === 0) return [];
  const sorted = [...options].sort((a, b) => b.label.length - a.label.length);
  const selected: string[] = [];
  let remaining = text;
  for (const opt of sorted) {
    const label = opt.label.trim();
    if (!label) continue;
    const at = remaining.indexOf(label);
    if (at < 0) continue;
    selected.push(label);
    remaining = `${remaining.slice(0, at)}\0${remaining.slice(at + label.length)}`;
  }
  // Preserve the order the options were originally listed in the clarify card.
  const order = new Map(options.map((o, i) => [o.label.trim(), i]));
  return selected.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * When the user multi-selects ≥2 concrete directions, those become research lanes
 * directly — planner is allowed to refine wording, but must not collapse them to 1.
 */
export function expandLanesFromClarifyAnswers(
  baseQuery: string,
  questions: ClarifyQuestion[],
  resume: ClarifyResumePayload,
): string[] | null {
  if (resume.skip || questions.length === 0) return null;
  const topic = baseQuery.trim() || "研究主题";
  let best: string[] = [];
  for (const q of questions) {
    const answer = resume.answers[q.id]?.trim();
    if (!answer) continue;
    const matched = matchSelectedOptions(answer, q.options);
    if (matched.length > best.length) best = matched;
  }
  if (best.length < 2) return null;
  return best.map((dir) => `${topic}：${dir}`).slice(0, MAX_LANES);
}

export async function runDeepResearchTurn(
  parsedBody: Record<string, unknown>,
  deps: DeepResearchDeps,
): Promise<Response> {
  const baseBody = stripFlags(parsedBody);
  const originalMessages = Array.isArray(baseBody.messages)
    ? (baseBody.messages as ChatMessage[])
    : [];
  let userQuery = extractLastUserQuery(originalMessages);
  const originalUserQuery = userQuery;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  // Clarify wait can last up to CLARIFY_TIMEOUT_MS (5m) and must NOT burn the
  // research budget — otherwise a slow answer collapses planning to 1 lane.
  let budgetPausedMs = 0;
  const budgetLeft = () => TOTAL_BUDGET_MS - (now() - startedAt - budgetPausedMs);
  /** Retrieval-side budget: keeps WRITE_RESERVE_MIN_MS untouched for section writing. */
  const searchBudgetLeft = () => budgetLeft() - WRITE_RESERVE_MIN_MS;
  const runId = deps.runId ?? ulid().toLowerCase();
  const tenantId = deps.tenantId ?? "tenant";
  const userId = deps.userId ?? "user";
  const sessionId = deps.sessionId ?? "session";
  const artifactStore = deps.artifactStore ?? createArtifactStore();
  const runStore = deps.runStore ?? defaultRunStore;
  const awaitClarify = deps.awaitClarify !== false;
  const clarifyTimeoutMs = deps.clarifyTimeoutMs ?? CLARIFY_TIMEOUT_MS;

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const deepResearchEnabled = tenant?.deepResearchEnabled ?? true;
  const searchCfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);
  const pageFetchCfg = resolvePageFetchConfig(tenant);

  if (!deepResearchEnabled) {
    const upstream = await callGatewayStream(deps, {
      ...baseBody,
      stream: true,
      messages: originalMessages,
    });
    return pipeWithPrefix(upstream, DEEP_RESEARCH_DISABLED_HINT);
  }

  if (!searchCfg.enabled) {
    const upstream = await callGatewayStream(deps, {
      ...baseBody,
      stream: true,
      messages: originalMessages,
    });
    return pipeWithPrefix(upstream, DEEP_RESEARCH_SEARCH_DISABLED_HINT);
  }

  const encoder = new TextEncoder();
  const searchFn = deps.executeSearch ?? executeWebSearch;
  const planFn = deps.buildPlan ?? buildResearchPlan;
  const clarifyFn = deps.proposeClarify ?? proposeClarification;
  const fetchPages = deps.fetchPagesFn ?? fetchPagesBatch;
  const expandFn = deps.expandQueriesFn ?? expandQueries;
  const reflectFn = deps.reflectFn ?? reflectOnGaps;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Transport signal only stops SSE writes; run signal drives search/fetch/gateway.
      const transportSignal = deps.signal;
      const runController = new AbortController();
      const runSignal = runController.signal;
      const toolDeps: DeepResearchDeps = { ...deps, signal: runSignal };
      let transportClosed = Boolean(transportSignal?.aborted);
      transportSignal?.addEventListener(
        "abort",
        () => {
          transportClosed = true;
        },
        { once: true },
      );

      let writer: RunWriter | null = null;
      try {
        await runStore.create({
          runId,
          tenantId,
          userId,
          sessionId,
          topic: userQuery || "深度调研",
        });
        writer = createRunWriter(runStore, runId);
      } catch (error) {
        console.warn("[deep-research] run-store create failed:", error);
      }

      const safeControllerEnqueue = (chunk: Uint8Array) => {
        if (transportClosed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          transportClosed = true;
        }
      };

      /** 客户端已 cancel Response body 时 close() 会抛 "Controller is already closed"。 */
      const safeClose = () => {
        // Always attempt close: transport abort sets transportClosed without closing
        // the controller (writes stop, but the consumer may still be reading).
        transportClosed = true;
        try {
          controller.close();
        } catch {
          // 客户端先断开，忽略。
        }
      };

      const enqueueDelta = (text: string) => {
        if (!text) return;
        writer?.pushReport(text);
        safeControllerEnqueue(encoder.encode(sseDelta(text)));
      };
      const enqueueEvent = (
        event: DeepResearchEvent,
        patch?: { status?: DeepResearchRunStatus; phase?: string },
      ) => {
        writer?.push(event, patch);
        safeControllerEnqueue(encoder.encode(formatDeepResearchEventSse(event)));
      };

      const persistFinish = async (
        status: "completed" | "failed" | "cancelled",
        errorMessage?: string,
      ) => {
        try {
          if (writer) {
            await writer.flush();
            await runStore.setCitations(runId, registrySnapshot());
            await writer.finish(status, errorMessage);
          } else {
            await runStore.setCitations(runId, registrySnapshot());
            await runStore.finish(runId, status, errorMessage);
          }
        } catch (persistError) {
          console.warn("[deep-research] run-store finish failed:", persistError);
        }
      };

      // Filled after CitationRegistry is constructed; used by persistFinish.
      let registrySnapshot: () => Citation[] = () => [];
      /** SSE comment + padding — force proxies/Next to flush before long awaits. */
      const enqueueFlush = () => {
        safeControllerEnqueue(encoder.encode(`: ping\n\n${" ".repeat(2048)}\n`));
      };

      /** 代理按读超时切流；lanes / synthesize 有分钟级静默窗口，必须定时喂字节。 */
      const HEARTBEAT_MS = 15_000;
      const heartbeat = setInterval(() => {
        enqueueFlush();
      }, HEARTBEAT_MS);
      // Node 侧不因心跳定时器阻止退出。
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      let artifactsWritten = 0;
      /** Separate from memo/report quota — page full-text archives. */
      let pagesArchived = 0;
      const reportContentParts: string[] = [];
      /** Final-report + P3 deliverables produced this run, for completion summary. */
      const producedArtifacts: Array<{
        id: string;
        path: string;
        title: string;
        kind: string;
      }> = [];
      /** Hoisted so the outer catch can degrade gracefully after synthesize. */
      let finalReportReady = false;
      let summarySent = false;
      let wrapupFallback: Parameters<typeof fallbackSummary>[0] | null = null;

      try {
        if (runSignal.aborted) throw new DOMException("Aborted", "AbortError");

        enqueueEvent({ type: "run_started", runId });
        enqueueFlush();

        // deps.fetchImpl 是「调 gateway」的实现，不能用来探外站；出网探测固定走
        // directFetch，需要替身时只允许注入 probeEgressFn。
        const egressOk = await (deps.probeEgressFn ?? probeEgress)(directFetch);
        if (!egressOk) {
          enqueueEvent({
            type: "narrative",
            text: "当前环境无法访问外部网站，深度调研已切换为「仅基于已有资料」模式，结论不含外部实时来源。",
          });
          enqueueFlush();
        }

        // --- Recon (knowledge cold-start) ---
        // Without this, clarify/plan reason from stale parametric knowledge and can
        // invent premises like "X has not been released yet". Emit a visible
        // lane so the timeline shows the cold-start search before clarify.
        enqueueEvent({
          type: "narrative",
          text: "我先快速检索最新公开资料，校准调研前提。",
        });
        enqueueEvent({ type: "phase", phase: "recon", message: "正在快速侦查最新现状…" });
        enqueueEvent({ type: "phase", phase: "lanes", message: "开题冷启动检索…" });
        const reconLaneId = "recon-cold-start";
        enqueueEvent({
          type: "lane_started",
          laneId: reconLaneId,
          title: userQuery || "开题冷启动",
          index: 1,
          total: 1,
        });
        enqueueFlush();
        const todayLine = formatTodayLine(now);
        let recon: ReconResult = { brief: "", hits: [] };
        if (budgetLeft() > 0) {
          try {
            recon = await (deps.runReconFn ?? runRecon)({
              query: userQuery,
              searchCfg,
              searchFn,
              fetchImpl: deps.fetchImpl,
              signal: runSignal,
              timeoutMs: RECON_TIMEOUT_MS,
            });
          } catch {
            recon = { brief: "", hits: [] };
          }
        }
        enqueueEvent({
          type: "lane_progress",
          laneId: reconLaneId,
          message: `已收集 ${recon.hits.length} 个来源`,
          sourcesCollected: recon.hits.length,
        });
        enqueueEvent({
          type: "lane_done",
          laneId: reconLaneId,
          status: recon.hits.length > 0 ? "ok" : "failed",
        });

        // --- Clarify gate ---
        enqueueEvent({ type: "phase", phase: "clarify", message: "正在判断是否需要澄清…" });
        enqueueFlush();
        let clarifyResult: ClarifierResult = { needed: false };
        if (budgetLeft() > 0) {
          // Bound clarifier so a slow gateway cannot leave the UI silent for minutes.
          const clarifyAbort = new AbortController();
          const onRunAbort = () => clarifyAbort.abort();
          runSignal.addEventListener("abort", onRunAbort, { once: true });
          const clarifyTimer = setTimeout(() => clarifyAbort.abort(), CLARIFIER_LLM_TIMEOUT_MS);
          try {
            clarifyResult = await clarifyFn({
              url: deps.url,
              headers: deps.headers,
              body: baseBody,
              userQuery,
              todayLine,
              reconBrief: recon.brief,
              fetchImpl: deps.fetchImpl,
              signal: clarifyAbort.signal,
            });
          } catch {
            clarifyResult = { needed: false };
          } finally {
            clearTimeout(clarifyTimer);
            runSignal.removeEventListener("abort", onRunAbort);
          }
        }

        let clarifyExpandedLanes: string[] | null = null;
        let deliveryPrefs: DeliveryPrefs = { ...DEFAULT_DELIVERY_PREFS };
        let clarifyResume: ClarifyResumePayload = { answers: {}, skip: true };
        const directionQuestions = clarifyResult.needed ? clarifyResult.questions : [];
        const askDelivery =
          clarifyResult.needed || looksOpenEndedResearchQuery(originalUserQuery);
        const clarifyQuestions = askDelivery
          ? [...directionQuestions, ...deliveryClarifyQuestions()].slice(0, 4)
          : [];

        if (clarifyQuestions.length > 0) {
          enqueueEvent({
            type: "narrative",
            text: "现状已校准，再确认一下调研方向与交付偏好。",
          });
          for (let i = 0; i < clarifyQuestions.length; i += 1) {
            const q = clarifyQuestions[i]!;
            enqueueEvent(
              {
                type: "clarify",
                runId,
                step: i + 1,
                total: clarifyQuestions.length,
                questionId: q.id,
                question: q.question,
                options: q.options,
                allowCustom: q.allowCustom,
                multiSelect: q.multiSelect,
              },
              i === 0 ? { status: "awaiting_clarify", phase: "clarify" } : undefined,
            );
          }
          enqueueFlush();

          if (awaitClarify) {
            const waitStarted = now();
            clarifyResume = await waitForClarifyResume(runId, clarifyTimeoutMs);
            budgetPausedMs += Math.max(0, now() - waitStarted);
            await runStore.appendEvents(runId, [], { status: "running" });
            if (clarifyResume.timedOut) {
              enqueueEvent({ type: "clarify_timeout", runId });
              enqueueEvent({ type: "narrative", text: "澄清超时，按默认假设继续。" });
            } else if (!clarifyResume.skip) {
              enqueueEvent({ type: "narrative", text: "已明确调研方向，开始系统检索。" });
            } else {
              enqueueEvent({ type: "narrative", text: "已跳过确认，按默认假设继续检索。" });
            }
          }
          if (clarifyResume.skip || clarifyResume.timedOut) {
            deliveryPrefs = { ...DEFAULT_DELIVERY_PREFS };
          } else {
            deliveryPrefs = parseDeliveryPrefs(clarifyResume.answers, clarifyQuestions);
          }
          const laneQuestions = clarifyQuestions.filter(
            (q) => !isDeliveryClarifyQuestionId(q.id),
          );
          clarifyExpandedLanes = expandLanesFromClarifyAnswers(
            originalUserQuery,
            laneQuestions,
            clarifyResume,
          );
        }

        // Clarify + delivery prefs are planner/writer hints only — never mutate the
        // display topic / final-report title via userQuery concatenation.
        let planningContext = applyClarifyAnswers(
          originalUserQuery,
          clarifyQuestions,
          clarifyResume,
        );
        planningContext = `${planningContext}\n\n${deliveryPrefsPromptBlock(deliveryPrefs)}`;
        const prefsWritingHint = [
          deliveryPrefsPromptBlock(deliveryPrefs),
          "",
          "（以上交付偏好仅供写作约束，禁止原样写入报告正文或标题。）",
        ].join("\n");

        // --- Plan ---
        enqueueEvent({ type: "phase", phase: "plan", message: "正在规划研究路径…" });

        let plan: ResearchPlan;
        if (searchBudgetLeft() <= 0) {
          plan = {
            topic: sanitizeResearchTopic(originalUserQuery || "研究主题"),
            complexity: "moderate",
            subQuestions: clarifyExpandedLanes?.length
              ? clarifyExpandedLanes
              : [originalUserQuery || "研究该主题"],
          };
        } else {
          plan = await planFn({
            url: deps.url,
            headers: deps.headers,
            body: baseBody,
            userQuery: planningContext,
            todayLine,
            reconBrief: recon.brief,
            fetchImpl: deps.fetchImpl,
            signal: runSignal,
          });
        }

        // Explicit multi-select directions always win over a collapsed planner output.
        if (clarifyExpandedLanes && clarifyExpandedLanes.length >= 2) {
          plan = {
            ...plan,
            complexity:
              clarifyExpandedLanes.length >= 6
                ? "complex"
                : clarifyExpandedLanes.length >= 4
                  ? "moderate"
                  : plan.complexity,
            subQuestions: clarifyExpandedLanes,
          };
        } else {
          // Injected buildPlan mocks / budget fallback can still collapse open asks.
          plan = enforcePlanBreadth(plan, originalUserQuery);
        }
        plan = {
          ...plan,
          topic: sanitizeResearchTopic(plan.topic || originalUserQuery || "研究主题"),
        };

        if (runSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Never collapse an explicit multi-select plan just because budget is tight —
        // still run at least those lanes (budget checks inside each lane remain).
        const questions = plan.subQuestions.slice(0, MAX_LANES);

        enqueueEvent({
          type: "phase",
          phase: "lanes",
          message: `已拆解 ${questions.length} 条调研车道，正在并行检索…`,
        });

        const registry = new CitationRegistry();
        registrySnapshot = () => registry.list();
        // Recon hits become citable sources and dedupe against later lane hits.
        const reconCitations: Citation[] = [];
        for (const hit of recon.hits) {
          if (registry.size >= MAX_SOURCES) break;
          reconCitations.push(registry.add(hit));
        }
        const resultsPerLane = resolveResultsPerLane(questions.length);
        let searchFailures = 0;
        let totalQueries = 0;
        let totalDiscovered = 0;
        let totalSelected = 0;
        let totalPagesFetched = 0;

        const runOneLane = async (args: {
          question: string;
          laneId: string;
          index: number;
          total: number;
          variants?: QueryVariant[];
          skipExpand?: boolean;
        }): Promise<LaneResult> => {
          const { question, laneId, index, total } = args;
          enqueueEvent({
            type: "lane_started",
            laneId,
            title: question,
            index,
            total,
          });

          const empty: LaneResult = {
            question,
            citations: [],
            memo: "",
            queriesPlanned: 0,
            urlsDiscovered: 0,
            sourcesSelected: 0,
            pagesFetched: 0,
          };

          try {
            if (runSignal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (searchBudgetLeft() <= 0) {
              enqueueEvent({ type: "lane_done", laneId, status: "failed" });
              return empty;
            }

            let variants = args.variants;
            if (!variants) {
              variants = args.skipExpand
                ? [{ query: question, kind: "primary" }]
                : await expandFn({
                    topic: plan.topic || originalUserQuery,
                    subQuestion: question,
                    todayLine,
                    callJson: async (messages) =>
                      callGatewayJson(toolDeps, { ...baseBody, messages }),
                  });
            }
            enqueueEvent({
              type: "lane_progress",
              laneId,
              message: `已展开 ${variants.length} 条检索式`,
            });

            const pool = new SourcePool();
            let variantFailures = 0;
            await mapPool(
              variants,
              SEARCH_CONCURRENCY,
              async (variant) => {
                try {
                  if (searchBudgetLeft() <= 0) return;
                  const hits = await searchFn(
                    variant.query,
                    resultsPerLane,
                    searchCfg,
                    deps.fetchImpl,
                  );
                  for (const hit of hits) pool.add(hit, variant.query);
                } catch (error) {
                  variantFailures += 1;
                  console.warn(
                    "[deep-research] variant search failed:",
                    error instanceof Error ? error.message : error,
                  );
                }
              },
              runSignal,
            );

            enqueueEvent({
              type: "lane_progress",
              laneId,
              message: `发现 ${pool.size} 个候选来源`,
            });

            if (pool.size === 0 && variantFailures >= variants.length) {
              searchFailures += 1;
              enqueueEvent({ type: "lane_done", laneId, status: "failed" });
              return { ...empty, queriesPlanned: variants.length };
            }

            const scored = scorePool(plan.topic || originalUserQuery, pool.list());
            const selected = selectTopSources(scored, resultsPerLane);
            enqueueEvent({
              type: "lane_progress",
              laneId,
              message: `筛选出 ${selected.length}/${pool.size} 个高质量来源`,
              sourcesCollected: selected.length,
            });

            const questionCitations: Citation[] = [];
            for (const row of selected) {
              if (registry.size >= MAX_SOURCES) break;
              questionCitations.push(registry.add(row.hit));
            }

            enqueueEvent({
              type: "lane_progress",
              laneId,
              message: `已收集 ${questionCitations.length} 个来源，正在读取正文…`,
              sourcesCollected: questionCitations.length,
            });

            let pagesFetched = 0;
            const fetchedUrls = new Set<string>();
            const archivedUrls = new Set<string>();
            if (questionCitations.length > 0 && searchBudgetLeft() > 0 && egressOk) {
              try {
                const { pages, stats } = await fetchPages(
                  questionCitations.map((c) => c.url),
                  {
                    signal: runSignal,
                    timeoutMs: Math.min(
                      PAGE_FETCH_TIMEOUT_MS,
                      Math.max(1_000, searchBudgetLeft()),
                    ),
                    backends: pageFetchCfg.backends,
                    apiKeys: pageFetchCfg.apiKeys,
                  },
                );
                for (const [i, page] of pages.entries()) {
                  if (!page) continue;
                  const citation = questionCitations[i];
                  if (!citation) continue;
                  registry.attachFullText(citation.url, page.text);
                  citation.fullText = page.text;
                  pagesFetched += 1;
                  fetchedUrls.add(citation.url);
                  if (pageFetchCfg.archivePages) {
                    const ok = await archivePage({
                      artifactStore,
                      tenantId,
                      userId,
                      sessionId,
                      runId,
                      url: citation.url,
                      title: citation.title,
                      backend: page.backend,
                      text: page.text,
                      archivedSoFar: pagesArchived,
                    });
                    if (ok) {
                      pagesArchived += 1;
                      archivedUrls.add(citation.url);
                    }
                  }
                }
                const failureNote = summarizeFetchFailures(stats);
                enqueueEvent({
                  type: "lane_progress",
                  laneId,
                  message: failureNote
                    ? `已读取 ${pagesFetched}/${questionCitations.length} 篇正文（${failureNote}）`
                    : `已读取 ${pagesFetched}/${questionCitations.length} 篇正文`,
                  sourcesCollected: questionCitations.length,
                });
              } catch (error) {
                console.warn(
                  "[deep-research] page fetch failed:",
                  error instanceof Error ? error.message : error,
                );
              }
            }

            if (questionCitations.length > 0) {
              enqueueEvent({
                type: "lane_sources",
                laneId,
                sources: questionCitations.map((c) => {
                  const snippet = c.snippet?.trim() ?? "";
                  return {
                    title: c.title,
                    url: c.url,
                    ...(snippet ? { snippet: snippet.slice(0, 200) } : {}),
                    ...(archivedUrls.has(c.url)
                      ? { archivedPath: pageArchivePath(runId, c.url, c.title) }
                      : {}),
                    fetched: fetchedUrls.has(c.url),
                  };
                }),
              });
            }

            let memo = "";
            if (questionCitations.length > 0 && searchBudgetLeft() > 0) {
              const evidenceBits = questionCitations
                .map((c) => {
                  const body = c.fullText ? c.fullText.slice(0, 2_000) : c.snippet;
                  return `[${c.index}] ${c.title}\n${body}`;
                })
                .join("\n\n");
              memo = await callGatewayJson(toolDeps, {
                ...baseBody,
                messages: [
                  { role: "system", content: LANE_SUMMARY_SYSTEM },
                  {
                    role: "user",
                    content: `子问题：${question}\n\n摘录：\n${evidenceBits}`,
                  },
                ],
              });
              if (!memo.trim()) {
                memo = questionCitations
                  .map((c) => `- [${c.index}] ${c.title}: ${c.snippet}`)
                  .join("\n");
              }
            } else if (questionCitations.length > 0) {
              memo = questionCitations
                .map((c) => `- [${c.index}] ${c.title}: ${c.snippet}`)
                .join("\n");
            }

            let artifactPath: string | undefined;
            // Reserve slots for final-report.md + report.html (+ report.doc when Word)
            // so lane memos cannot exhaust the run quota before primary deliverables.
            const reservedPrimarySlots = deliveryPrefs.format === "docx" ? 3 : 2;
            const memoQuota = Math.max(0, MAX_ARTIFACTS_PER_RUN - reservedPrimarySlots);
            if (memo.trim() && artifactsWritten < memoQuota) {
              const path = `research/${runId}/lanes/${laneId}/memo.md`;
              const record = await artifactStore.write({
                tenantId,
                userId,
                sessionId,
                runId,
                path,
                title: `${question} · 备忘`,
                kind: "memo",
                content: `# ${question}\n\n${memo.trim()}\n`,
              });
              artifactsWritten += 1;
              artifactPath = record.path;
              enqueueEvent({
                type: "artifact",
                id: record.id,
                path: record.path,
                title: record.title,
                kind: "memo",
                bytes: record.byteSize,
              });
            }

            enqueueEvent({
              type: "lane_done",
              laneId,
              artifactPath,
              status: questionCitations.length > 0 ? "ok" : "failed",
            });
            return {
              question,
              citations: questionCitations,
              memo,
              queriesPlanned: variants.length,
              urlsDiscovered: pool.size,
              sourcesSelected: questionCitations.length,
              pagesFetched,
            };
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            searchFailures += 1;
            console.warn(
              "[deep-research] lane failed:",
              error instanceof Error ? error.message : error,
            );
            enqueueEvent({ type: "lane_done", laneId, status: "failed" });
            return empty;
          }
        };

        const citationsByQuestion = await mapPool(
          questions,
          SEARCH_CONCURRENCY,
          async (question, index) =>
            runOneLane({
              question,
              laneId: slugifyLane(question, index),
              index: index + 1,
              total: questions.length,
            }),
          runSignal,
        );

        for (const row of citationsByQuestion) {
          totalQueries += row.queriesPlanned;
          totalDiscovered += row.urlsDiscovered;
          totalSelected += row.sourcesSelected;
          totalPagesFetched += row.pagesFetched;
        }

        // Recon hits sit in the registry too, so judge failure by lane output only.
        const laneCitationCount = citationsByQuestion.reduce(
          (sum, item) => sum + item.citations.length,
          0,
        );
        if (laneCitationCount === 0 && searchFailures >= questions.length) {
          enqueueEvent(
            { type: "phase", phase: "done", message: "检索全部失败" },
            { status: "failed", phase: "done" },
          );
          enqueueDelta(DEEP_RESEARCH_SEARCH_FAILED);
          await persistFinish("failed", DEEP_RESEARCH_SEARCH_FAILED);
          safeControllerEnqueue(encoder.encode("data: [DONE]\n\n"));
          safeClose();
          return;
        }

        if (runSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        // --- Reflect + one-shot follow-up search ---
        if (searchBudgetLeft() > REFLECT_MIN_BUDGET_MS) {
          enqueueEvent({
            type: "phase",
            phase: "reflect",
            message: "正在复盘已收集证据，识别信息缺口…",
          });
          let gaps: ResearchGap[] = [];
          try {
            gaps = await reflectFn({
              topic: plan.topic || originalUserQuery,
              todayLine,
              laneMemos: citationsByQuestion.map((r) => ({
                question: r.question,
                memo: r.memo,
              })),
              callJson: async (messages) =>
                callGatewayJson(toolDeps, { ...baseBody, messages }),
            });
          } catch {
            gaps = [];
          }

          if (gaps.length > 0) {
            // The gap card is itself the "发现 N 处信息缺口" announcement, and the
            // follow-up lanes card carries the "补充检索" step — a narrative saying
            // both would just duplicate the two cards around it.
            enqueueEvent({
              type: "reflection",
              gaps: gaps.map((g) => g.description),
            });
            enqueueEvent({
              type: "phase",
              phase: "lanes",
              message: `正在针对 ${gaps.length} 处缺口补充检索…`,
            });
            const gapResults = await mapPool(
              gaps,
              SEARCH_CONCURRENCY,
              async (gap, gapIndex) => {
                const queries = gap.queries.map(
                  (q): QueryVariant => ({ query: q, kind: "term" }),
                );
                return runOneLane({
                  question: gap.description,
                  laneId: `gap-${gap.id}`,
                  index: gapIndex + 1,
                  total: gaps.length,
                  variants: queries,
                  skipExpand: true,
                });
              },
              runSignal,
            );
            for (const row of gapResults) {
              citationsByQuestion.push(row);
              totalQueries += row.queriesPlanned;
              totalDiscovered += row.urlsDiscovered;
              totalSelected += row.sourcesSelected;
              totalPagesFetched += row.pagesFetched;
            }
          } else {
            enqueueEvent({
              type: "narrative",
              text: "证据交叉验证充分，未发现需要补搜的缺口。",
            });
          }
        }

        enqueueEvent({
          type: "research_stats",
          queriesPlanned: totalQueries,
          urlsDiscovered: totalDiscovered,
          sourcesSelected: totalSelected,
          pagesFetched: totalPagesFetched,
        });

        // --- Synthesize (outline → sectioned long-form) ---
        enqueueEvent({
          type: "narrative",
          text: "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
        });
        // Refresh Bearer before outline/section writes — search may have run for
        // many minutes on a frozen access JWT from request start.
        if (deps.refreshAccessToken) {
          await refreshGatewayBearer({
            headers: toolDeps.headers,
            refreshAccessToken: deps.refreshAccessToken,
          });
        }
        enqueueEvent({ type: "phase", phase: "synthesize", message: "正在拟定报告大纲…" });

        const evidence = [
          prefsWritingHint,
          "",
          formatEvidencePack(plan, citationsByQuestion, reconCitations),
        ].join("\n");
        const outline = await buildReportOutline({
          topic: sanitizeResearchTopic(plan.topic || originalUserQuery || "调研报告"),
          evidence,
          callJson: async (messages) =>
            callGatewayJson(toolDeps, {
              ...baseBody,
              messages,
            }),
        });
        outline.title = sanitizeResearchTopic(outline.title);

        const streamSectionInto = async (
          messages: Array<{ role: string; content: string }>,
        ): Promise<string> => {
          const upstream = await callGatewayStream(toolDeps, {
            ...baseBody,
            stream: true,
            messages,
          });
          if (!upstream.ok || !upstream.body) {
            const errText = await upstream.text().catch(() => "gateway error");
            const note = `\n\n> 本节撰写失败：${errText.slice(0, 200)}`;
            enqueueDelta(note);
            reportContentParts.push(note);
            return "";
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const sectionParts: string[] = [];
          while (true) {
            if (runSignal?.aborted) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              throw new DOMException("Aborted", "AbortError");
            }
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
                // forward non-data keepalive/comment frames as-is
                safeControllerEnqueue(encoder.encode(`${frame}\n\n`));
                continue;
              }
              const data = dataLine.replace(/^data:\s*/, "");
              if (data === "[DONE]") continue;
              let isContentDelta = false;
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const piece = parsed.choices?.[0]?.delta?.content;
                if (typeof piece === "string") {
                  sectionParts.push(piece);
                  reportContentParts.push(piece);
                  writer?.pushReport(piece);
                  isContentDelta = true;
                }
              } catch {
                // forward non-delta frames as-is
              }
              // Report content deltas are NOT forwarded to the chat transport —
              // the chat area shows only a completion summary, not the full report.
              if (!isContentDelta) {
                safeControllerEnqueue(encoder.encode(`${frame}\n\n`));
              }
            }
          }
          return stripThinkBlocks(sectionParts.join(""));
        };

        // Build report content silently: accumulate into reportContentParts + run-store only.
        const titleBlock = `# ${sanitizeResearchTopic(outline.title)}\n\n`;
        reportContentParts.push(titleBlock);
        const toc = renderTableOfContents(outline);
        reportContentParts.push(toc);

        const previousSummaries: string[] = [];
        let truncated = false;
        for (let i = 0; i < outline.sections.length; i += 1) {
          const section = outline.sections[i]!;
          if (budgetLeft() <= 0) {
            truncated = true;
            const remaining = outline.sections
              .slice(i)
              .map((s) => s.title)
              .join("、");
            const note = `\n\n> 报告因时间预算截断，以下章节未展开：${remaining}`;
            reportContentParts.push(note);
            break;
          }
          enqueueEvent({
            type: "phase",
            phase: "synthesize",
            message: `正在撰写第 ${i + 1}/${outline.sections.length} 节：${section.title}`,
          });
          const heading = `\n\n## ${section.title}\n\n`;
          reportContentParts.push(heading);
          const sectionBody = await streamSectionInto(
            buildSectionMessages({
              outline,
              section,
              sectionIndex: i,
              evidence,
              previousSummaries,
            }),
          );
          const tableLike =
            section.format === "comparison_table" || section.format === "tradeoff";
          const noEvidence = registrySnapshot().length === 0;
          if (!sectionMeetsFormat(section, sectionBody) && !(tableLike && noEvidence)) {
            console.warn(
              "[deep-research] section format miss",
              section.id,
              section.format,
            );
          }
          if (sectionBody.trim()) {
            previousSummaries.push(sectionBody.trim().slice(0, 200));
          }
        }
        if (!truncated) {
          enqueueEvent({ type: "phase", phase: "synthesize", message: "正在综合分析…" });
        }

        const citations = registry.list();
        const validIndexes = new Set(citations.map((c) => c.index));
        const finalReport = linkifyCitations(
          stripThinkBlocks(reportContentParts.join("")),
          validIndexes,
        );
        // Once the markdown body exists, later wrap-up failures must not look like
        // a search failure — the user already has a usable report artifact.
        const summaryInput = {
          topic: sanitizeResearchTopic(plan.topic || originalUserQuery || "调研报告"),
          outline: {
            ...outline,
            title: sanitizeResearchTopic(outline.title),
            sections: outline.sections.map((sec) => ({
              ...sec,
              title: sanitizeResearchTopic(sec.title),
            })),
          },
          stats: {
            queriesPlanned: totalQueries,
            urlsDiscovered: totalDiscovered,
            sourcesSelected: totalSelected,
            pagesFetched: totalPagesFetched,
            citationCount: citations.length,
          },
          artifacts: producedArtifacts.map((a) => ({
            ...a,
            title: sanitizeResearchTopic(a.title || a.path),
          })),
          runId,
          deliveryPrefs,
        };
        wrapupFallback = summaryInput;

        if (finalReport.trim() && artifactsWritten < MAX_ARTIFACTS_PER_RUN) {
          const path = `research/${runId}/final-report.md`;
          const mdTitle = primaryArtifactTitle(
            plan.topic || outline.title || "调研报告",
            { ...deliveryPrefs, format: "md" },
          );
          const record = await artifactStore.write({
            tenantId,
            userId,
            sessionId,
            runId,
            path,
            title: mdTitle,
            kind: "report",
            content: finalReport,
          });
          artifactsWritten += 1;
          producedArtifacts.push({
            id: record.id,
            path: record.path,
            title: record.title,
            kind: "report",
          });
          finalReportReady = true;
          enqueueEvent({
            type: "artifact",
            id: record.id,
            path: record.path,
            title: record.title,
            kind: "report",
            bytes: record.byteSize,
          });
        } else if (finalReport.trim()) {
          finalReportReady = true;
        }

        // P3: HTML deliverable — best-effort; do not fail the run.
        if (finalReport.trim()) {
          const collectArtifactEvent = (event: DeepResearchEvent) => {
            if (event.type === "artifact" && event.path && event.id) {
              producedArtifacts.push({
                id: event.id,
                path: event.path,
                title: event.title ?? "",
                kind: event.kind ?? "report",
              });
            }
            enqueueEvent(event);
          };
          try {
            artifactsWritten = await finalizeReportArtifacts({
              artifactStore,
              tenantId,
              userId,
              sessionId,
              runId,
              topic: plan.topic || originalUserQuery || "调研报告",
              outline,
              markdown: finalReport,
              citations,
              stats: {
                queriesPlanned: totalQueries,
                urlsDiscovered: totalDiscovered,
                sourcesSelected: totalSelected,
                pagesFetched: totalPagesFetched,
              },
              artifactsWritten,
              deliveryPrefs,
              enqueueEvent: collectArtifactEvent,
            });
          } catch (finalizeError) {
            const reason =
              finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
            console.warn("[deep-research] finalizeReportArtifacts failed:", reason);
            enqueueEvent({
              type: "narrative",
              text: `可视化 HTML 版本生成失败（${reason}）。完整正文已保存为 Markdown 交付物，可直接下载查看。`,
            });
          }
        }

        // Completion summary: LLM-generated natural-language wrap-up (not the full report).
        // The chat area shows only this summary; the full report lives in artifacts.
        try {
          summaryInput.artifacts = producedArtifacts;
          summaryInput.deliveryPrefs = deliveryPrefs;
          const summary = await buildCompletionSummary(summaryInput, {
            callJson: (messages) =>
              callGatewayJson(toolDeps, { ...baseBody, messages }),
          });
          if (summary.trim()) {
            enqueueDelta(summary);
            summarySent = true;
          }
        } catch (summaryError) {
          console.warn(
            "[deep-research] completion summary failed:",
            summaryError instanceof Error ? summaryError.message : summaryError,
          );
        }
        if (!summarySent && finalReportReady) {
          summaryInput.artifacts = producedArtifacts;
          summaryInput.deliveryPrefs = deliveryPrefs;
          enqueueDelta(fallbackSummary(summaryInput));
          summarySent = true;
        }

        try {
          const sourcesFrame = formatWebSearchSourcesSse(citationsToHits(citations));
          if (sourcesFrame) safeControllerEnqueue(encoder.encode(sourcesFrame));
        } catch (sourcesError) {
          console.warn(
            "[deep-research] sources frame failed:",
            sourcesError instanceof Error ? sourcesError.message : sourcesError,
          );
        }

        enqueueEvent(
          { type: "phase", phase: "done", message: "深度研究完成" },
          { status: "completed", phase: "done" },
        );
        await persistFinish("completed");
        safeControllerEnqueue(encoder.encode("data: [DONE]\n\n"));
        safeClose();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          enqueueEvent(
            { type: "phase", phase: "done", message: "已取消" },
            { status: "cancelled", phase: "done" },
          );
          await persistFinish("cancelled");
          safeControllerEnqueue(encoder.encode("data: [DONE]\n\n"));
          safeClose();
          return;
        }
        console.warn("[deep-research] pipeline failed:", error);
        const message = error instanceof Error ? error.message : "pipeline failed";
        // If the markdown report already landed, degrade gracefully instead of
        // claiming "检索失败" (which is wrong after synthesize has finished).
        if (finalReportReady) {
          try {
            if (!summarySent && wrapupFallback) {
              wrapupFallback.artifacts = producedArtifacts;
              enqueueDelta(fallbackSummary(wrapupFallback));
            }
            enqueueDelta(`\n\n${DEEP_RESEARCH_WRAPUP_DEGRADED}`);
          } catch {
            enqueueDelta(`\n\n${DEEP_RESEARCH_WRAPUP_DEGRADED}`);
          }
          enqueueEvent(
            {
              type: "phase",
              phase: "done",
              message: "深度研究完成（部分收尾失败）",
            },
            { status: "completed", phase: "done" },
          );
          await persistFinish("completed", message);
        } else {
          enqueueDelta(`\n\n${DEEP_RESEARCH_SEARCH_FAILED}`);
          enqueueEvent(
            { type: "phase", phase: "done", message: "失败" },
            { status: "failed", phase: "done" },
          );
          await persistFinish("failed", message);
        }
        safeControllerEnqueue(encoder.encode("data: [DONE]\n\n"));
        safeClose();
      } finally {
        clearInterval(heartbeat);
      }
    },
  });

  return eventStreamResponse(stream);
}

/** Test helper: plain failure stream when all searches fail (exported for AC). */
export function deepResearchSearchFailedResponse(): Response {
  return textOnlyDoneStream(DEEP_RESEARCH_SEARCH_FAILED);
}

export type { WebSearchHit };
