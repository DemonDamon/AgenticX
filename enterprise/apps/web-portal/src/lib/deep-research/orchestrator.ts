/**
 * Deep research workbench: clarify → plan → parallel lanes → synthesize → sources SSE.
 */

import { ulid } from "ulid";
import {
  executeWebSearch,
  type WebSearchHit,
  type WebSearchRuntimeConfig,
} from "../web-search/providers";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "../web-search/config";
import { formatWebSearchSourcesSse } from "../web-search/tool-loop";
import { buildResearchPlan, type ResearchPlan } from "./planner";
import { CitationRegistry, type Citation } from "./registry";
import { formatDeepResearchEventSse } from "./events";
import { stripThinkBlocks } from "./content-clean";
import {
  proposeClarification,
  type ClarifierResult,
  type ClarifyQuestion,
} from "./clarifier";
import {
  waitForClarifyResume,
  type ClarifyResumePayload,
} from "./run-wait";
import {
  createArtifactStore,
  type ArtifactStore,
  MAX_ARTIFACTS_PER_RUN,
} from "./artifact-store";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";

export const SEARCH_CONCURRENCY = 3;
export const RESULTS_PER_QUESTION = 5;
export const MAX_SOURCES = 25;
export const MAX_LANES = 5;
export const TOTAL_BUDGET_MS = 180_000;
/** Default wait for clarify answers before continuing with skip/defaults. */
export const CLARIFY_TIMEOUT_MS = 300_000;
/** Max wait for the optional clarifier LLM call (not the user resume wait). */
export const CLARIFIER_LLM_TIMEOUT_MS = 20_000;

export const DEEP_RESEARCH_DISABLED_HINT = "> 管理员未开启深度研究，以下为普通回答。\n\n";
export const DEEP_RESEARCH_SEARCH_DISABLED_HINT =
  "> 管理员未开启联网搜索，深度研究不可用，以下为普通回答。\n\n";
export const DEEP_RESEARCH_SEARCH_FAILED =
  "> 深度研究检索失败，请稍后重试或改用普通对话。";

const SYNTH_SYSTEM = [
  "你是深度研究综述助手。根据证据包撰写结构化 Markdown 报告，必须包含三节：",
  "「核心结论」「分项分析」「不确定性与信息缺口」。",
  "每条来自证据的事实必须以 [N] 标注，N 与证据包编号严格一致。",
  "禁止编造证据包中不存在的编号；证据不足时明确说明，禁止臆测。",
].join("");

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
  artifactStore?: ArtifactStore;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
  clarifyTimeoutMs?: number;
  /** Skip clarify wait (tests). When false and clarifier needed, still emits clarify then continues with skip. */
  awaitClarify?: boolean;
  signal?: AbortSignal;
  now?: () => number;
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

export function formatEvidencePack(
  plan: ResearchPlan,
  citationsByQuestion: Array<{ question: string; citations: Citation[]; memo?: string }>,
): string {
  const parts = [`研究主题：${plan.topic}`, ""];
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
      parts.push(`摘要：${c.snippet}`);
      parts.push("");
    }
  });
  return parts.join("\n").trim();
}

/** Kept for unit tests / legacy callers; main path no longer appends this to content. */
export function formatSourcesAppendix(citations: Citation[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map((c) => `[${c.index}] ${c.title} — ${c.url}`);
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
      controller.close();
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
      controller.close();
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

export async function runDeepResearchTurn(
  parsedBody: Record<string, unknown>,
  deps: DeepResearchDeps,
): Promise<Response> {
  const baseBody = stripFlags(parsedBody);
  const originalMessages = Array.isArray(baseBody.messages)
    ? (baseBody.messages as ChatMessage[])
    : [];
  let userQuery = extractLastUserQuery(originalMessages);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetLeft = () => TOTAL_BUDGET_MS - (now() - startedAt);
  const runId = deps.runId ?? ulid().toLowerCase();
  const tenantId = deps.tenantId ?? "tenant";
  const userId = deps.userId ?? "user";
  const sessionId = deps.sessionId ?? "session";
  const artifactStore = deps.artifactStore ?? createArtifactStore();
  const awaitClarify = deps.awaitClarify !== false;
  const clarifyTimeoutMs = deps.clarifyTimeoutMs ?? CLARIFY_TIMEOUT_MS;

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const deepResearchEnabled = tenant?.deepResearchEnabled ?? true;
  const searchCfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueueDelta = (text: string) => {
        if (!text) return;
        controller.enqueue(encoder.encode(sseDelta(text)));
      };
      const enqueueEvent = (event: DeepResearchEvent) => {
        controller.enqueue(encoder.encode(formatDeepResearchEventSse(event)));
      };
      /** SSE comment + padding — force proxies/Next to flush before long awaits. */
      const enqueueFlush = () => {
        controller.enqueue(encoder.encode(`: ping\n\n${" ".repeat(2048)}\n`));
      };

      let artifactsWritten = 0;
      const reportContentParts: string[] = [];

      try {
        if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        enqueueEvent({ type: "run_started", runId });
        enqueueFlush();

        // --- Clarify gate ---
        enqueueEvent({ type: "phase", phase: "clarify", message: "正在判断是否需要澄清…" });
        enqueueFlush();
        let clarifyResult: ClarifierResult = { needed: false };
        if (budgetLeft() > 0) {
          // Bound clarifier so a slow gateway cannot leave the UI silent for minutes.
          const clarifyAbort = new AbortController();
          const onParentAbort = () => clarifyAbort.abort();
          deps.signal?.addEventListener("abort", onParentAbort, { once: true });
          const clarifyTimer = setTimeout(() => clarifyAbort.abort(), CLARIFIER_LLM_TIMEOUT_MS);
          try {
            clarifyResult = await clarifyFn({
              url: deps.url,
              headers: deps.headers,
              body: baseBody,
              userQuery,
              fetchImpl: deps.fetchImpl,
              signal: clarifyAbort.signal,
            });
          } catch {
            clarifyResult = { needed: false };
          } finally {
            clearTimeout(clarifyTimer);
            deps.signal?.removeEventListener("abort", onParentAbort);
          }
        }

        if (clarifyResult.needed) {
          const questions = clarifyResult.questions;
          enqueueEvent({
            type: "narrative",
            text: "我先快速确认一下调研方向，然后开始系统检索。",
          });
          for (let i = 0; i < questions.length; i += 1) {
            const q = questions[i]!;
            enqueueEvent({
              type: "clarify",
              runId,
              step: i + 1,
              total: questions.length,
              questionId: q.id,
              question: q.question,
              options: q.options,
              allowCustom: q.allowCustom,
            });
          }
          enqueueFlush();

          let resume: ClarifyResumePayload = { answers: {}, skip: true };
          if (awaitClarify) {
            resume = await waitForClarifyResume(runId, clarifyTimeoutMs);
            if (resume.timedOut) {
              enqueueEvent({ type: "clarify_timeout", runId });
              enqueueEvent({ type: "narrative", text: "澄清超时，按默认假设继续。" });
            } else if (!resume.skip) {
              enqueueEvent({ type: "narrative", text: "已明确调研方向，开始系统检索。" });
            } else {
              enqueueEvent({ type: "narrative", text: "已跳过确认，按默认假设继续检索。" });
            }
          }
          userQuery = applyClarifyAnswers(userQuery, questions, resume);
        }

        // --- Plan ---
        enqueueEvent({ type: "phase", phase: "plan", message: "正在规划研究路径…" });

        let plan: ResearchPlan;
        if (budgetLeft() <= 0) {
          plan = { topic: userQuery || "研究主题", subQuestions: [userQuery || "研究该主题"] };
        } else {
          plan = await planFn({
            url: deps.url,
            headers: deps.headers,
            body: baseBody,
            userQuery,
            fetchImpl: deps.fetchImpl,
            signal: deps.signal,
          });
        }

        if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        const questions =
          budgetLeft() <= 0
            ? plan.subQuestions.slice(0, 1)
            : plan.subQuestions.slice(0, MAX_LANES);

        enqueueEvent({
          type: "phase",
          phase: "lanes",
          message: `已拆解 ${questions.length} 条调研车道，正在并行检索…`,
        });

        const registry = new CitationRegistry();
        let searchFailures = 0;

        const citationsByQuestion = await mapPool(
          questions,
          SEARCH_CONCURRENCY,
          async (question, index) => {
            const laneId = slugifyLane(question, index);
            enqueueEvent({
              type: "lane_started",
              laneId,
              title: question,
              index: index + 1,
              total: questions.length,
            });

            try {
              if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");
              if (budgetLeft() <= 0) {
                enqueueEvent({ type: "lane_done", laneId, status: "failed" });
                return { question, citations: [] as Citation[], memo: "" };
              }

              const hits = await searchFn(question, RESULTS_PER_QUESTION, searchCfg, deps.fetchImpl);
              const questionCitations: Citation[] = [];
              for (const hit of hits) {
                if (registry.size >= MAX_SOURCES) break;
                questionCitations.push(registry.add(hit));
              }

              enqueueEvent({
                type: "lane_progress",
                laneId,
                message: `已收集 ${questionCitations.length} 个来源`,
                sourcesCollected: questionCitations.length,
              });

              let memo = "";
              if (questionCitations.length > 0 && budgetLeft() > 0) {
                const evidenceBits = questionCitations
                  .map((c) => `[${c.index}] ${c.title}\n${c.snippet}`)
                  .join("\n\n");
                memo = await callGatewayJson(deps, {
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
              if (memo.trim() && artifactsWritten < MAX_ARTIFACTS_PER_RUN) {
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
              return { question, citations: questionCitations, memo };
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              searchFailures += 1;
              console.warn(
                "[deep-research] lane failed:",
                error instanceof Error ? error.message : error,
              );
              enqueueEvent({ type: "lane_done", laneId, status: "failed" });
              return { question, citations: [] as Citation[], memo: "" };
            }
          },
          deps.signal,
        );

        if (registry.size === 0 && searchFailures >= questions.length) {
          enqueueEvent({ type: "phase", phase: "done", message: "检索全部失败" });
          enqueueDelta(DEEP_RESEARCH_SEARCH_FAILED);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        // --- Synthesize ---
        enqueueEvent({
          type: "narrative",
          text: "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
        });
        enqueueEvent({ type: "phase", phase: "synthesize", message: "正在综合分析…" });

        const evidence = formatEvidencePack(plan, citationsByQuestion);
        const synthMessages: ChatMessage[] = [
          { role: "system", content: SYNTH_SYSTEM },
          ...originalMessages.filter((m) => m.role !== "system"),
          { role: "user", content: evidence },
        ];

        const upstream = await callGatewayStream(deps, {
          ...baseBody,
          stream: true,
          messages: synthMessages,
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => "gateway error");
          enqueueDelta(`\n\n> 深度研究综述失败：${errText.slice(0, 200)}`);
          enqueueEvent({ type: "phase", phase: "done", message: "综述失败" });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          if (deps.signal?.aborted) {
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
              controller.enqueue(encoder.encode(`${frame}\n\n`));
              continue;
            }
            const data = dataLine.replace(/^data:\s*/, "");
            if (data === "[DONE]") {
              continue;
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const piece = parsed.choices?.[0]?.delta?.content;
              if (typeof piece === "string") reportContentParts.push(piece);
            } catch {
              // forward non-delta frames as-is
            }
            controller.enqueue(encoder.encode(`${frame}\n\n`));
          }
        }

        const finalReport = stripThinkBlocks(reportContentParts.join(""));
        if (finalReport.trim() && artifactsWritten < MAX_ARTIFACTS_PER_RUN) {
          const path = `research/${runId}/final-report.md`;
          const record = await artifactStore.write({
            tenantId,
            userId,
            sessionId,
            runId,
            path,
            title: `${plan.topic || "调研报告"} · 终稿`,
            kind: "report",
            content: finalReport,
          });
          artifactsWritten += 1;
          enqueueEvent({
            type: "artifact",
            id: record.id,
            path: record.path,
            title: record.title,
            kind: "report",
            bytes: record.byteSize,
          });
        }

        const sourcesFrame = formatWebSearchSourcesSse(citationsToHits(registry.list()));
        if (sourcesFrame) controller.enqueue(encoder.encode(sourcesFrame));

        enqueueEvent({ type: "phase", phase: "done", message: "深度研究完成" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          enqueueEvent({ type: "phase", phase: "done", message: "已取消" });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        console.warn("[deep-research] pipeline failed:", error);
        enqueueDelta(`\n\n${DEEP_RESEARCH_SEARCH_FAILED}`);
        enqueueEvent({ type: "phase", phase: "done", message: "失败" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
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
