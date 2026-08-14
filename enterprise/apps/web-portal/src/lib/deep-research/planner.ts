/**
 * Deep research stage 1: plan sub-questions via a non-streaming JSON completion.
 */

import { extractJsonText } from "./llm-json";
import {
  defaultFacetLanes,
  looksOpenEndedResearchQuery,
  parseResearchComplexity,
  RESEARCH_COMPLEXITY_GUIDANCE,
  type ResearchComplexity,
} from "./research-intent";
import { DIRECT_DOCUMENT_RESEARCH_ANCHOR_POLICY } from "./direct-document-intent";

export type { ResearchComplexity } from "./research-intent";

export const MIN_SUB_QUESTIONS = 2;
/** Must stay ≤ orchestrator MAX_LANES (cost + UI lane budget). */
export const MAX_SUB_QUESTIONS = 5;
/** Open-ended research asks should fan out at least this many lanes. */
export const OPEN_ENDED_MIN_LANES = 4;

export type ResearchPlan = {
  topic: string;
  complexity: ResearchComplexity;
  subQuestions: string[];
};

export type PlannerDeps = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  userQuery: string;
  /** Current-date grounding line (see recon.formatTodayLine). */
  todayLine?: string;
  /** Cold-start search digest (see recon.buildReconBrief). */
  reconBrief?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const PLANNER_SYSTEM = [
  "你是研究规划助手。根据用户问题拆解研究路径。",
  "只输出 JSON，不要 Markdown 围栏，不要其它解释。",
  '格式严格为：{"topic":"...","complexity":"simple|moderate|complex","sub_questions":["...","..."]}',
  `先按统一口径判断问题复杂度：${RESEARCH_COMPLEXITY_GUIDANCE}。再据此决定 sub_questions 条数：simple ${MIN_SUB_QUESTIONS}-3 条；moderate 3-4 条；complex 4-${MAX_SUB_QUESTIONS} 条。总数不得超过 ${MAX_SUB_QUESTIONS}。`,
  "『核心技术点』『全面分析』『综述』『对比』『调研』等开放题一律至少 moderate，禁止只输出 1 条子问题，也禁止把用户原问原样当作唯一子问题。",
  "禁止为凑数拆出重复或空洞的子问题：宁少勿滥，每条必须能独立检索且彼此不重叠。",
  "若用户澄清中列出了多个彼此独立的技术方向/关注点，必须为每个方向各建一条 sub_question，禁止合并成一条综合检索，也禁止把整段『【用户澄清】』原文当作唯一子问题。",
  DIRECT_DOCUMENT_RESEARCH_ANCHOR_POLICY,
  "若下方提供了检索现状，据其判断该主题的信息密度与复杂度，并以其为事实基线；检索现状不能成为只拆 1 条车道的理由。",
  "使用与用户提问相同的语言。",
].join("");

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "");
}

/** Keep open-ended asks from collapsing into a single raw-query lane after recon. */
export function enforcePlanBreadth(plan: ResearchPlan, userQuery: string): ResearchPlan {
  const base = userQuery.trim() || plan.topic;
  const openEnded = looksOpenEndedResearchQuery(base);
  if (!openEnded) return plan;

  const onlyRaw =
    plan.subQuestions.length <= 1 &&
    plan.subQuestions.every((q) => {
      const a = normalizeKey(q);
      const b = normalizeKey(base);
      return !a || a === b || a.includes(b) || b.includes(a);
    });

  // Already a real multi-lane plan — only bump complexity if the model under-labeled it.
  if (!onlyRaw && plan.subQuestions.length >= MIN_SUB_QUESTIONS) {
    return plan.complexity === "simple" ? { ...plan, complexity: "moderate" } : plan;
  }

  const facets = defaultFacetLanes(plan.topic || base).slice(0, OPEN_ENDED_MIN_LANES);
  return {
    topic: plan.topic || base,
    complexity: plan.complexity === "simple" ? "moderate" : plan.complexity,
    subQuestions: facets,
  };
}

function normalizeSubQuestions(raw: unknown, fallbackQuery: string): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const q = item.trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_SUB_QUESTIONS) break;
  }
  if (out.length === 0) {
    const q = fallbackQuery.trim() || "研究该主题";
    return [q];
  }
  return out;
}

export function parseResearchPlanJson(text: string, fallbackQuery: string): ResearchPlan {
  const fallback: ResearchPlan = {
    topic: fallbackQuery.trim() || "研究主题",
    complexity: "moderate",
    subQuestions: [fallbackQuery.trim() || "研究该主题"],
  };

  const tryParse = (raw: string): ResearchPlan | null => {
    try {
      const parsed = JSON.parse(raw) as {
        topic?: unknown;
        complexity?: unknown;
        sub_questions?: unknown;
        subQuestions?: unknown;
      };
      const topic =
        typeof parsed.topic === "string" && parsed.topic.trim()
          ? parsed.topic.trim()
          : fallback.topic;
      const subQuestions = normalizeSubQuestions(
        parsed.sub_questions ?? parsed.subQuestions,
        fallbackQuery,
      );
      return {
        topic,
        complexity: parseResearchComplexity(parsed.complexity) ?? "moderate",
        subQuestions,
      };
    } catch {
      return null;
    }
  };

  // Models wrap payloads in <think> / fences / prose; normalize before the tier chain.
  const trimmed = extractJsonText(text) || text.trim();
  if (!trimmed) return fallback;

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const fromFence = tryParse(fenced[1].trim());
    if (fromFence) return fromFence;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    const fromObject = tryParse(objectMatch[0]);
    if (fromObject) return fromObject;
  }

  return fallback;
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  if (typeof first?.text === "string") return first.text;
  return "";
}

export async function buildResearchPlan(deps: PlannerDeps): Promise<ResearchPlan> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const userQuery = deps.userQuery.trim() || "研究该主题";
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 30_000);
  const onParentAbort = () => timeoutController.abort();
  if (deps.signal) {
    if (deps.signal.aborted) timeoutController.abort();
    else deps.signal.addEventListener("abort", onParentAbort, { once: true });
  }
  const signal = timeoutController.signal;

  const { tools: _tools, tool_choice: _toolChoice, stream: _stream, ...rest } = deps.body;
  const messages = [
    { role: "system", content: PLANNER_SYSTEM },
    ...(deps.todayLine ? [{ role: "system", content: deps.todayLine }] : []),
    ...(deps.reconBrief ? [{ role: "system", content: deps.reconBrief }] : []),
    { role: "user", content: userQuery },
  ];

  try {
    const response = await fetchImpl(deps.url, {
      method: "POST",
      headers: deps.headers,
      body: JSON.stringify({
        ...rest,
        stream: false,
        messages,
      }),
      signal,
    });
    if (!response.ok) {
      return parseResearchPlanJson("", userQuery);
    }
    const payload = (await response.json()) as unknown;
    const text = extractCompletionText(payload);
    return enforcePlanBreadth(parseResearchPlanJson(text, userQuery), userQuery);
  } catch {
    return enforcePlanBreadth(parseResearchPlanJson("", userQuery), userQuery);
  } finally {
    clearTimeout(timeoutId);
    deps.signal?.removeEventListener("abort", onParentAbort);
  }
}
