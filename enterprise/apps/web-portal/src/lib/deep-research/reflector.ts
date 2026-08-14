/**
 * Reflect on collected lane memos and propose follow-up search gaps.
 */

import { parseLlmJson } from "./llm-json";
import {
  normalizeSelfContainedSearchQueries,
  selfContainedSearchPlanInstruction,
} from "../web-search/follow-up";

/** Longitudinal refinement: one highest-value gap per round. */
export const MAX_GAPS_PER_ROUND = 1;
/** Backward-compatible alias for callers/tests that imported the old cap. */
export const MAX_GAPS = MAX_GAPS_PER_ROUND;
export const MAX_QUERIES_PER_GAP = 3;
export const MAX_REFLECT_ROUNDS = 3;
/** Total top-level follow-up queries across every reflection round. */
export const MAX_FOLLOWUP_QUERIES = 6;

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
  "你是调研内部证据复盘助手。根据已收集的全部车道备忘，只识别最值得继续检索的一个证据缺口。",
  '只输出 JSON：{"gaps":[{"id":"g1","description":"...","queries":["..."]}]}；无缺口输出 {"gaps":[]}。',
  "缺口必须同时满足：会实质改变对原始主题的答案；当前备忘尚未回答；能由具体公开检索补齐。",
  "优先定位第一方资料、原始评测、可复现实验、直接数据或能澄清冲突的权威来源。",
  "禁止输出‘资料可能不全’‘仍需更多研究’‘通用方法论’‘来源置信度’等不可操作的泛化缺口。",
  `gaps 最多 ${MAX_GAPS_PER_ROUND} 条。`,
  selfContainedSearchPlanInstruction(MAX_QUERIES_PER_GAP, "queries"),
].join("\n");

export function parseGapsJson(raw: string): ResearchGap[] {
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") return [];

  const gapsRaw = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  const gaps: ResearchGap[] = [];
  const seenDescriptions = new Set<string>();
  for (const item of gapsRaw) {
    if (gaps.length >= MAX_GAPS_PER_ROUND) break;
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const description =
      typeof obj.description === "string" ? obj.description.trim() : "";
    if (!description) continue;
    const descriptionKey = description
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/\s+/gu, " ");
    if (seenDescriptions.has(descriptionKey)) continue;
    if (!Array.isArray(obj.queries)) continue;
    const queries = normalizeSelfContainedSearchQueries({
      resolvedQuery: description,
      candidates: obj.queries,
      maxSearchCalls: MAX_QUERIES_PER_GAP,
    });
    if (!queries) continue;
    seenDescriptions.add(descriptionKey);
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
