import type { WebSearchHit } from "./providers";

const RRF_K = 60;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ASCII_WORD = /[a-z0-9]+/gi;

function isAsciiDigit(char: string | undefined): boolean {
  return Boolean(char && char >= "0" && char <= "9");
}

/** Keep the original token and add generic letter/number boundary variants. */
function pushAsciiTokens(tokens: string[], value: string): void {
  const word = value.toLowerCase();
  tokens.push(word);
  if (!word) return;

  const variants = new Set<string>();
  let start = 0;
  let digitRun = isAsciiDigit(word[0]);
  for (let index = 1; index < word.length; index += 1) {
    const nextDigitRun = isAsciiDigit(word[index]);
    if (nextDigitRun === digitRun) continue;
    variants.add(word.slice(start, index));
    start = index;
    digitRun = nextDigitRun;
  }
  variants.add(word.slice(start));
  for (const variant of variants) {
    if (variant && variant !== word) tokens.push(variant);
  }
}

/** CJK 无分词：中文按 bigram，ASCII 按小写单词。 */
export function tokenize(text: string): string[] {
  const raw = text.normalize("NFKC").trim();
  if (!raw) return [];
  const tokens: string[] = [];
  let previousAscii: { value: string; end: number } | null = null;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (CJK_CHAR.test(ch)) {
      previousAscii = null;
      let j = i;
      while (j < raw.length && CJK_CHAR.test(raw[j]!)) j += 1;
      const run = raw.slice(i, j);
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let k = 0; k < run.length - 1; k += 1) {
          tokens.push(run.slice(k, k + 2));
        }
      }
      i = j;
      continue;
    }
    ASCII_WORD.lastIndex = i;
    const m = ASCII_WORD.exec(raw);
    if (m && m.index === i) {
      const word = m[0]!.toLowerCase();
      const inlineGap = previousAscii ? raw.slice(previousAscii.end, i) : "";
      if (
        previousAscii &&
        inlineGap.length <= 3 &&
        !inlineGap.includes("\n") &&
        !inlineGap.includes("\r") &&
        isAsciiDigit(previousAscii.value[previousAscii.value.length - 1]) !==
          isAsciiDigit(word[0])
      ) {
        tokens.push(`${previousAscii.value}${word}`);
      }
      pushAsciiTokens(tokens, word);
      previousAscii = { value: word, end: m.index + m[0]!.length };
      i = m.index + m[0]!.length;
      continue;
    }
    i += 1;
  }
  return tokens;
}

function docText(hit: WebSearchHit): string {
  return `${hit.title ?? ""} ${hit.snippet ?? ""}`.trim();
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

function bm25Scores(queryTokens: string[], docs: string[][]): number[] {
  const n = docs.length;
  if (n === 0) return [];
  const docTfs = docs.map(termFreq);
  const docLens = docs.map((d) => d.length);
  const avgdl = docLens.reduce((a, b) => a + b, 0) / n || 1;

  const df = new Map<string, number>();
  for (const term of new Set(queryTokens)) {
    let count = 0;
    for (const tf of docTfs) {
      if (tf.has(term)) count += 1;
    }
    df.set(term, count);
  }

  return docTfs.map((tf, idx) => {
    const dl = docLens[idx] || 0;
    let score = 0;
    for (const term of queryTokens) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const n_q = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - n_q + 0.5) / (n_q + 0.5));
      const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
      score += idf * ((f * (BM25_K1 + 1)) / denom);
    }
    return score;
  });
}

export type RankedTextPassage = {
  index: number;
  text: string;
  score: number;
};

/** Generic lexical passage ranking shared by search hits and direct page reads. */
export function rankTextPassages(query: string, passages: string[]): RankedTextPassage[] {
  const queryTokens = tokenize(query);
  const docs = passages.map(tokenize);
  const scores = queryTokens.length > 0 ? bm25Scores(queryTokens, docs) : passages.map(() => 0);
  return passages
    .map((text, index) => ({ index, text, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * BM25(k1=1.5, b=0.75) 打分后与 provider 原始排序做加权 RRF 融合：
 *   score = 2/(60 + bm25Rank) + 1/(60 + providerRank)
 * BM25 权重更高，才能把靠后但真正相关的命中捞到前面；provider 序仍作稳定信号。
 */
export function rerankHits(query: string, hits: WebSearchHit[]): WebSearchHit[] {
  if (!query.trim() || hits.length <= 1) return hits.slice();

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return hits.slice();

  const docs = hits.map((h) => tokenize(docText(h)));
  const scores = bm25Scores(queryTokens, docs);

  const bm25Order = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  const bm25Rank = new Array<number>(hits.length);
  bm25Order.forEach((row, rank) => {
    bm25Rank[row.index] = rank;
  });

  const fused = hits.map((hit, index) => ({
    hit,
    index,
    score: 2 / (RRF_K + (bm25Rank[index] ?? index)) + 1 / (RRF_K + index),
  }));

  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return fused.map((row) => row.hit);
}
