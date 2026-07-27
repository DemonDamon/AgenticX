/**
 * Deep research stage 1: plan sub-questions via a non-streaming JSON completion.
 */

export const MAX_SUB_QUESTIONS = 5;

export type ResearchPlan = {
  topic: string;
  subQuestions: string[];
};

export type PlannerDeps = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  userQuery: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const PLANNER_SYSTEM = [
  "你是研究规划助手。根据用户问题拆解研究路径。",
  "只输出 JSON，不要 Markdown 围栏，不要其它解释。",
  '格式严格为：{"topic":"...","sub_questions":["...","..."]}',
  `sub_questions 必须 3 到 ${MAX_SUB_QUESTIONS} 条，覆盖不同角度，使用与用户提问相同的语言。`,
].join("");

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
    subQuestions: [fallbackQuery.trim() || "研究该主题"],
  };

  const tryParse = (raw: string): ResearchPlan | null => {
    try {
      const parsed = JSON.parse(raw) as {
        topic?: unknown;
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
      return { topic, subQuestions };
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
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
    return parseResearchPlanJson(text, userQuery);
  } catch {
    return parseResearchPlanJson("", userQuery);
  } finally {
    clearTimeout(timeoutId);
    deps.signal?.removeEventListener("abort", onParentAbort);
  }
}
