/**
 * Optional clarification gate before deep-research planning.
 */

export type ClarifyQuestion = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  allowCustom?: boolean;
};

export type ClarifierResult =
  | { needed: false }
  | { needed: true; questions: ClarifyQuestion[] };

export type ClarifierDeps = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  userQuery: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const CLARIFIER_SYSTEM = [
  "你是调研开题助手。判断用户问题是否缺少关键约束，导致结论会显著不同。",
  "只输出 JSON，不要 Markdown 围栏。",
  '格式：{"needed":false} 或 {"needed":true,"questions":[{"id":"q1","question":"...","options":[{"id":"a","label":"..."}],"allowCustom":true}]}',
  "questions 最多 2 条；每题 options 2–4 个。不确定时 needed=false。",
].join("");

function normalizeQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `q${out.length + 1}`;
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!question) continue;
    const optionsRaw = Array.isArray(row.options) ? row.options : [];
    const options: Array<{ id: string; label: string }> = [];
    for (const opt of optionsRaw) {
      if (!opt || typeof opt !== "object") continue;
      const o = opt as Record<string, unknown>;
      const oid = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `o${options.length + 1}`;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!label) continue;
      options.push({ id: oid, label });
      if (options.length >= 4) break;
    }
    if (options.length < 2) continue;
    out.push({
      id,
      question,
      options,
      allowCustom: Boolean(row.allowCustom),
    });
    if (out.length >= 2) break;
  }
  return out;
}

export function parseClarifierJson(text: string): ClarifierResult {
  const tryParse = (raw: string): ClarifierResult | null => {
    try {
      const parsed = JSON.parse(raw) as { needed?: unknown; questions?: unknown };
      if (parsed.needed !== true) return { needed: false };
      const questions = normalizeQuestions(parsed.questions);
      if (questions.length === 0) return { needed: false };
      return { needed: true, questions };
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
  if (!trimmed) return { needed: false };
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
  return { needed: false };
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

export async function proposeClarification(deps: ClarifierDeps): Promise<ClarifierResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { tools: _t, tool_choice: _tc, stream: _s, ...rest } = deps.body;
  try {
    const response = await fetchImpl(deps.url, {
      method: "POST",
      headers: deps.headers,
      body: JSON.stringify({
        ...rest,
        stream: false,
        messages: [
          { role: "system", content: CLARIFIER_SYSTEM },
          { role: "user", content: deps.userQuery },
        ],
      }),
      signal: deps.signal,
    });
    if (!response.ok) return { needed: false };
    const payload = (await response.json()) as unknown;
    return parseClarifierJson(extractCompletionText(payload));
  } catch {
    return { needed: false };
  }
}
