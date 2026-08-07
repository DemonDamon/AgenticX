/**
 * Expand one research sub-question into multiple search query variants.
 */

import { parseLlmJson } from "./llm-json";

export const MIN_VARIANTS_PER_LANE = 2;
export const MAX_VARIANTS_PER_LANE = 4;

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export type QueryVariant = {
  query: string;
  kind: "primary" | "term" | "english" | "authority" | "recency" | "contrarian";
};

export type ExpandDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  subQuestion: string;
  todayLine: string;
};

const EXPAND_SYSTEM = [
  "你是调研检索式扩展助手。只输出 JSON 数组，不要 Markdown 围栏。",
  '格式：[{"query":"...","kind":"term"}]',
  `条数 ${MIN_VARIANTS_PER_LANE}-${MAX_VARIANTS_PER_LANE}。必须包含一条 kind=primary（子问题原文）。`,
  "变体应覆盖：术语同义、英文检索、权威源（论文/官方文档/技术报告）、时效限定、反面/质疑向。",
  "禁止彼此近乎重复的变体。kind 取值：primary|term|english|authority|recency|contrarian。",
].join("\n");

const KIND_SET = new Set<QueryVariant["kind"]>([
  "primary",
  "term",
  "english",
  "authority",
  "recency",
  "contrarian",
]);

function dedupeVariants(variants: QueryVariant[]): QueryVariant[] {
  const seen = new Set<string>();
  const out: QueryVariant[] = [];
  for (const v of variants) {
    const key = v.query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ query: v.query.trim(), kind: v.kind });
    if (out.length >= MAX_VARIANTS_PER_LANE) break;
  }
  return out;
}

/** 不依赖 LLM 的确定性回落。 */
export function heuristicVariants(subQuestion: string): QueryVariant[] {
  const q = subQuestion.trim() || "research";
  const variants: QueryVariant[] = [
    { query: q, kind: "primary" },
    { query: `${q} 技术报告 论文`, kind: "authority" },
    { query: `${q} 官方 文档`, kind: "authority" },
  ];
  if (CJK_CHAR.test(q)) {
    variants.push({ query: `${q} english`, kind: "english" });
  }
  return dedupeVariants(variants);
}

export function parseVariantsJson(raw: string, subQuestion: string): QueryVariant[] {
  const fallback = heuristicVariants(subQuestion);
  const parsed = parseLlmJson<unknown>(raw);
  if (!Array.isArray(parsed)) return fallback;

  const variants: QueryVariant[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const query = typeof obj.query === "string" ? obj.query.trim() : "";
    if (!query) continue;
    const kindRaw = typeof obj.kind === "string" ? obj.kind : "term";
    const kind = KIND_SET.has(kindRaw as QueryVariant["kind"])
      ? (kindRaw as QueryVariant["kind"])
      : "term";
    variants.push({ query, kind });
  }
  const deduped = dedupeVariants(variants);
  if (deduped.length === 0) return fallback;
  if (!deduped.some((v) => v.kind === "primary")) {
    deduped.unshift({ query: subQuestion.trim() || "research", kind: "primary" });
    return dedupeVariants(deduped);
  }
  return deduped.length >= MIN_VARIANTS_PER_LANE
    ? deduped
    : dedupeVariants([...deduped, ...fallback]);
}

/** LLM 扩展失败时回落到 heuristicVariants，绝不抛。 */
export async function expandQueries(deps: ExpandDeps): Promise<QueryVariant[]> {
  try {
    const raw = await deps.callJson([
      { role: "system", content: EXPAND_SYSTEM },
      {
        role: "user",
        content: [
          `主题：${deps.topic}`,
          `子问题：${deps.subQuestion}`,
          deps.todayLine,
        ].join("\n"),
      },
    ]);
    return parseVariantsJson(raw, deps.subQuestion);
  } catch {
    return heuristicVariants(deps.subQuestion);
  }
}
