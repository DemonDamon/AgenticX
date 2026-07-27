/**
 * Deep research BFF pipeline: plan → parallel search → synthesize → sources appendix.
 */

import {
  executeWebSearch,
  type WebSearchHit,
  type WebSearchRuntimeConfig,
} from "../web-search/providers";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "../web-search/config";
import { buildResearchPlan, type ResearchPlan } from "./planner";
import { CitationRegistry, type Citation } from "./registry";

export const SEARCH_CONCURRENCY = 3;
export const RESULTS_PER_QUESTION = 5;
export const MAX_SOURCES = 25;
export const TOTAL_BUDGET_MS = 180_000;

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
      "cache-control": "no-cache",
      connection: "keep-alive",
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

export function formatEvidencePack(
  plan: ResearchPlan,
  citationsByQuestion: Array<{ question: string; citations: Citation[] }>,
): string {
  const parts = [`研究主题：${plan.topic}`, ""];
  citationsByQuestion.forEach((item, idx) => {
    parts.push(`## 子问题 ${idx + 1}：${item.question}`);
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

export async function runDeepResearchTurn(
  parsedBody: Record<string, unknown>,
  deps: DeepResearchDeps,
): Promise<Response> {
  const baseBody = stripFlags(parsedBody);
  const originalMessages = Array.isArray(baseBody.messages)
    ? (baseBody.messages as ChatMessage[])
    : [];
  const userQuery = extractLastUserQuery(originalMessages);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetLeft = () => TOTAL_BUDGET_MS - (now() - startedAt);

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  // No tenant row → product default ON (matches getPublicWebSearchConfig).
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueueDelta = (text: string) => {
        if (!text) return;
        controller.enqueue(encoder.encode(sseDelta(text)));
      };

      try {
        if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        enqueueDelta("> 深度研究进行中\n> 1/3 正在规划研究路径…");

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

        enqueueDelta(
          `\n> 2/3 已拆解 ${plan.subQuestions.length} 个子问题，正在检索…（已收集 0 个来源）`,
        );

        const registry = new CitationRegistry();
        let searchFailures = 0;

        const questions =
          budgetLeft() <= 0 ? plan.subQuestions.slice(0, 1) : plan.subQuestions;

        const citationsByQuestion = await mapPool(
          questions,
          SEARCH_CONCURRENCY,
          async (question) => {
            try {
              if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");
              if (budgetLeft() <= 0) {
                return { question, citations: [] as Citation[] };
              }
              const hits = await searchFn(question, RESULTS_PER_QUESTION, searchCfg, deps.fetchImpl);
              const questionCitations: Citation[] = [];
              for (const hit of hits) {
                if (registry.size >= MAX_SOURCES) break;
                questionCitations.push(registry.add(hit));
              }
              enqueueDelta(`\n> …（已收集 ${registry.size} 个来源）`);
              return { question, citations: questionCitations };
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              searchFailures += 1;
              console.warn(
                "[deep-research] sub-question search failed:",
                error instanceof Error ? error.message : error,
              );
              return { question, citations: [] as Citation[] };
            }
          },
          deps.signal,
        );

        if (registry.size === 0 && searchFailures >= questions.length) {
          enqueueDelta(`\n\n${DEEP_RESEARCH_SEARCH_FAILED}`);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        enqueueDelta("\n> 3/3 正在综合分析…");
        enqueueDelta("\n\n---\n\n");

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
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDone = false;
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
              sawDone = true;
              continue;
            }
            controller.enqueue(encoder.encode(`${frame}\n\n`));
          }
        }

        const appendix = formatSourcesAppendix(registry.list());
        if (appendix) enqueueDelta(appendix);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        if (!sawDone) {
          // already enqueued DONE
        }
        controller.close();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        console.warn("[deep-research] pipeline failed:", error);
        enqueueDelta(`\n\n${DEEP_RESEARCH_SEARCH_FAILED}`);
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
