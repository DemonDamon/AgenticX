/**
 * Candidate source pool with authority + RRF scoring for deep research.
 */

import type { WebSearchHit } from "../web-search/providers";
import { rerankHits } from "../web-search/rerank";
import { normalizeCitationUrl } from "./registry";

export type PooledHit = {
  hit: WebSearchHit;
  matchedQueries: string[];
  hitCount: number;
};

export type ScoredHit = PooledHit & { score: number };

/** Hostname / pattern tiers for authorityBoost (higher wins). */
export const AUTHORITY_TIERS = {
  high: ["arxiv.org", "nature.com", "science.org", "ieee.org", "acm.org"],
  highSuffix: [".edu", ".gov"],
  highAc: true,
  mid: [
    "github.com",
    "huggingface.co",
    "openai.com",
    "deepseek.com",
    "anthropic.com",
  ],
  community: ["zhihu.com", "medium.com", "infoq.cn", "csdn.net", "zhuanlan.zhihu.com"],
} as const;

export class SourcePool {
  private readonly byKey = new Map<string, PooledHit>();
  private readonly order: string[] = [];

  add(hit: WebSearchHit, query: string): void {
    const key = normalizeCitationUrl(hit.url);
    const existing = this.byKey.get(key);
    if (existing) {
      existing.hitCount += 1;
      if (!existing.matchedQueries.includes(query)) {
        existing.matchedQueries.push(query);
      }
      return;
    }
    this.byKey.set(key, {
      hit,
      matchedQueries: [query],
      hitCount: 1,
    });
    this.order.push(key);
  }

  list(): PooledHit[] {
    return this.order.map((k) => this.byKey.get(k)!).filter(Boolean);
  }

  get size(): number {
    return this.byKey.size;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 域名权威度加成，0–1。 */
export function authorityBoost(url: string): number {
  const host = hostnameOf(url);
  if (!host) return 0.2;
  if (AUTHORITY_TIERS.high.some((d) => host === d || host.endsWith(`.${d}`))) return 1;
  if (AUTHORITY_TIERS.highSuffix.some((s) => host.endsWith(s))) return 1;
  if (/\.ac\./i.test(host)) return 1;
  if (AUTHORITY_TIERS.mid.some((d) => host === d || host.endsWith(`.${d}`))) return 0.8;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (
      (path.includes("/docs/") || path.includes("/blog/")) &&
      AUTHORITY_TIERS.mid.some((d) => host === d || host.endsWith(`.${d}`))
    ) {
      return 0.8;
    }
  } catch {
    // ignore
  }
  if (AUTHORITY_TIERS.community.some((d) => host === d || host.endsWith(`.${d}`))) {
    return 0.5;
  }
  return 0.2;
}

/**
 * score = 0.55 * rrfFromRerank + 0.25 * authorityBoost + 0.20 * repeatBoost
 */
export function scorePool(topic: string, pool: PooledHit[]): ScoredHit[] {
  if (pool.length === 0) return [];
  const hits = pool.map((p) => p.hit);
  const reranked = rerankHits(topic, hits);
  const rankByUrl = new Map<string, number>();
  reranked.forEach((hit, rank) => {
    rankByUrl.set(normalizeCitationUrl(hit.url), rank);
  });

  const rrfRaw = pool.map((p) => {
    const rank = rankByUrl.get(normalizeCitationUrl(p.hit.url)) ?? pool.length;
    return 1 / (60 + rank);
  });
  const maxRrf = Math.max(...rrfRaw, 1e-9);

  return pool.map((p, index) => {
    const rrfNorm = rrfRaw[index]! / maxRrf;
    const repeatBoost = Math.min(1, (p.hitCount - 1) / 2);
    const score = 0.55 * rrfNorm + 0.25 * authorityBoost(p.hit.url) + 0.2 * repeatBoost;
    return { ...p, score };
  });
}

/**
 * 单域名配额随候选池大小放宽。
 *
 * 固定 3 条在大池子里能防单站刷屏，但一个车道只搜出六七个候选时，官网
 * 连续几页文档就会被直接丢掉——池子越小，多样性约束的代价越高。
 */
export function adaptiveMaxPerDomain(poolSize: number): number {
  if (poolSize <= 12) return 5;
  if (poolSize <= 24) return 4;
  return 3;
}

/** 取 TopN，并强制单域名不超过 maxPerDomain 条。 */
export function selectTopSources(
  scored: ScoredHit[],
  topN: number,
  maxPerDomain = 3,
): ScoredHit[] {
  const ordered = scored
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (b.item.score !== a.item.score) return b.item.score - a.item.score;
      return a.index - b.index;
    })
    .map((row) => row.item);

  const out: ScoredHit[] = [];
  const perDomain = new Map<string, number>();
  for (const row of ordered) {
    if (out.length >= topN) break;
    const host = hostnameOf(row.hit.url) || "unknown";
    const used = perDomain.get(host) ?? 0;
    if (used >= maxPerDomain) continue;
    perDomain.set(host, used + 1);
    out.push(row);
  }
  return out;
}
