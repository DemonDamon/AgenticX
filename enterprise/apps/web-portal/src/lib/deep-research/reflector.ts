/**
 * Reflect on collected lane memos and propose follow-up search gaps.
 */

import { parseLlmJson } from "./llm-json";

/** At most one information-gap follow-up lane (cost control). */
export const MAX_GAPS = 1;
/** Query budget for the single follow-up gap. */
export const MAX_FOLLOWUP_QUERIES = 3;

export type ResearchGap = {
  id: string;
  description: string;
  queries: string[];
};

export type ReflectDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  laneMemos: Array<{ question: string; memo: string }>;
  todayLine: string;
};

const REFLECT_SYSTEM = [
  "你是调研复盘助手。根据已收集的车道备忘识别仍可用再检索解决的信息缺口。",
  '只输出 JSON：{"gaps":[{"id":"g1","description":"...","queries":["..."]}]}；无缺口输出 {"gaps":[]}。',
  "重点判据：单一来源缺乏交叉验证；缺少官方一手文献；互相矛盾未澄清；时间线/数字未获权威确认。",
  `gaps 最多 ${MAX_GAPS} 条，每条 1–3 个 queries。只报能靠再搜一次解决的缺口。`,
].join("\n");

export function parseGapsJson(raw: string): ResearchGap[] {
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") return [];

  const gapsRaw = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  const gaps: ResearchGap[] = [];
  let queryBudget = MAX_FOLLOWUP_QUERIES;
  for (const item of gapsRaw) {
    if (gaps.length >= MAX_GAPS || queryBudget <= 0) break;
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const description =
      typeof obj.description === "string" ? obj.description.trim() : "";
    if (!description) continue;
    const queries = Array.isArray(obj.queries)
      ? obj.queries
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim())
          .slice(0, Math.min(3, queryBudget))
      : [];
    if (queries.length === 0) continue;
    queryBudget -= queries.length;
    const id =
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim()
        : `g${gaps.length + 1}`;
    gaps.push({ id, description, queries });
  }
  return gaps;
}

/** 失败或无缺口时返回 []，绝不抛。 */
export async function reflectOnGaps(deps: ReflectDeps): Promise<ResearchGap[]> {
  try {
    const memoBlock = deps.laneMemos
      .map((m, i) => `### 车道 ${i + 1}：${m.question}\n${m.memo || "（无备忘）"}`)
      .join("\n\n");
    const raw = await deps.callJson([
      { role: "system", content: REFLECT_SYSTEM },
      {
        role: "user",
        content: [`主题：${deps.topic}`, deps.todayLine, "", memoBlock].join("\n"),
      },
    ]);
    return parseGapsJson(raw);
  } catch {
    return [];
  }
}
