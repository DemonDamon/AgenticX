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
  "每条变体必须换检索角度：改换关键词、语言或限定源。仅增删助词、标点、语序的变体一律不要——它们会命中同一批网页，等于白花检索配额。",
  "kind 取值：primary|term|english|authority|recency|contrarian。",
].join("\n");

const KIND_SET = new Set<QueryVariant["kind"]>([
  "primary",
  "term",
  "english",
  "authority",
  "recency",
  "contrarian",
]);

/** Near-duplicate gate: same bigram profile AND near-identical length. */
export const NEAR_DUPLICATE_SIMILARITY = 0.9;
/** Beyond this many differing characters, treat it as a genuinely new angle. */
export const NEAR_DUPLICATE_LENGTH_DELTA = 3;

/**
 * Chinese function words carrying no retrieval signal.
 *
 * Kept deliberately narrow — particles and modal words only. Conjunctions like
 * 和/与/及 stay, because "A 和 B 对比" and "AB" are not the same query.
 */
const CJK_FUNCTION_WORDS = /[的地得之了吗呢啊吧]/gu;

/** Strip whitespace, punctuation and particles so "X 的架构" ≡ "X架构". */
function normalizeForSimilarity(query: string): string {
  return query
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(CJK_FUNCTION_WORDS, "");
}

/** Character bigrams — works for CJK, which has no token boundaries. */
function bigrams(text: string): Set<string> {
  if (text.length <= 1) return new Set(text ? [text] : []);
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2));
  return out;
}

/** Jaccard overlap of character bigrams, 0–1. */
export function querySimilarity(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const setA = bigrams(na);
  const setB = bigrams(nb);
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 只拦「换皮」变体，不拦换角度的变体。
 *
 * 观测到 19 条检索式只去重出 31 个唯一 URL，主因是 LLM 产出的变体互相只差
 * 助词/标点/语序——搜索按请求次数计费，这类变体是纯浪费。但加了限定词（如
 * 「技术报告 论文」）的变体确实换了检索意图，长度差因此参与判定：只有长度
 * 几乎一致且 bigram 高度重合才算重复。
 */
export function isNearDuplicateQuery(a: string, b: string): boolean {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) > NEAR_DUPLICATE_LENGTH_DELTA) return false;
  return querySimilarity(a, b) >= NEAR_DUPLICATE_SIMILARITY;
}

function dedupeVariants(variants: QueryVariant[]): QueryVariant[] {
  const out: QueryVariant[] = [];
  for (const v of variants) {
    const query = v.query.trim();
    if (!query) continue;
    if (out.some((kept) => isNearDuplicateQuery(kept.query, query))) continue;
    out.push({ query, kind: v.kind });
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
