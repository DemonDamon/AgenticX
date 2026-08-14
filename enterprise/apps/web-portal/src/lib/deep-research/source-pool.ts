/**
 * Candidate source pool with authority + RRF scoring for deep research.
 */

import type { WebSearchHit } from "../web-search/providers";
import { rerankHits } from "../web-search/rerank";
import {
  diversifyBySourceHost,
  sourceHostname,
} from "../retrieval/source-diversity";
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

/** Second-level suffixes that are registry labels, not the owner's brand. */
const REGISTRY_SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
/** Paths and subdomains a vendor uses for its own primary material. */
const FIRST_PARTY_SEGMENTS = ["docs", "developer", "api", "research", "documentation"];
/** Latin entity tokens shorter than this carry no identity signal. */
const MIN_ENTITY_TOKEN_CHARS = 3;
const GENERIC_ENTITY_TOKENS = new Set([
  "the", "and", "for", "with", "how", "what", "why", "who", "when", "where",
  "new", "best", "top", "latest", "news", "guide", "docs", "doc", "api", "web",
  "app", "data", "code", "test", "model", "models", "search", "report", "review",
  "blog", "site", "page", "www", "com", "org", "net", "info", "online", "free",
  "vs", "versus", "about", "into", "from", "that", "this", "your", "his", "her",
]);

/** Registrable label of the host — `docs.acme.co.uk` → `acme`. */
export function primaryDomainLabel(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  const secondLast = parts[parts.length - 2]!;
  // `example.co.uk` / `example.ac.cn`: the label sits one level further left.
  if (parts.length >= 3 && REGISTRY_SECOND_LEVEL.has(secondLast) && last.length <= 3) {
    return parts[parts.length - 3]!;
  }
  return secondLast;
}

/** Distinctive Latin tokens from the research question. */
export function entityTokens(topic: string): string[] {
  const tokens = new Set<string>();
  for (const raw of topic.toLowerCase().match(/[a-z][a-z0-9]*/gu) ?? []) {
    if (raw.length < MIN_ENTITY_TOKEN_CHARS) continue;
    if (GENERIC_ENTITY_TOKENS.has(raw)) continue;
    tokens.add(raw);
  }
  return [...tokens];
}

/**
 * A vendor's own docs/developer/research site for an entity the question names.
 *
 * Deliberately narrow: the registrable label must match a topic token exactly,
 * and the URL must look like primary material. A `.ai` suffix or a page that
 * merely calls itself "official" proves nothing and gets no boost.
 */
export function firstPartyAuthority(url: string, topic: string): boolean {
  const host = sourceHostname(url);
  if (!host) return false;
  const label = primaryDomainLabel(host);
  if (label.length < MIN_ENTITY_TOKEN_CHARS) return false;
  if (!entityTokens(topic).includes(label)) return false;

  const subdomain = host.toLowerCase().slice(0, Math.max(0, host.length - label.length));
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = "";
  }
  return FIRST_PARTY_SEGMENTS.some(
    (segment) => subdomain.includes(`${segment}.`) || path.includes(`/${segment}`),
  );
}

/** 域名权威度加成，0–1。 */
export function authorityBoost(url: string, topic = ""): number {
  const host = sourceHostname(url);
  if (!host) return 0.2;
  const base = staticAuthorityBoost(url, host);
  // The dynamic signal only ever supplements the static priors.
  if (topic && base < 0.8 && firstPartyAuthority(url, topic)) return 0.8;
  return base;
}

function staticAuthorityBoost(url: string, host: string): number {
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

/** Age buckets for time-sensitive lanes; only ever a down-weight, never a filter. */
export const FRESHNESS_RECENT_DAYS = 30;
export const FRESHNESS_NEAR_DAYS = 180;
export const FRESHNESS_STALE_DAYS = 730;
/** Missing, malformed and impossibly-future dates all land here. */
export const FRESHNESS_UNKNOWN_SCORE = 0.5;

const DAY_MS = 24 * 60 * 60 * 1_000;
/** Provider clock skew tolerance before a date counts as "the future". */
const FUTURE_TOLERANCE_MS = 2 * DAY_MS;

/**
 * 0–1 recency weight. An unknown date scores mid-band on purpose: it must not
 * beat a genuinely recent source, and it must not be dropped either.
 */
export function freshnessScore(publishedAt: string | undefined, now: number): number {
  if (!publishedAt) return FRESHNESS_UNKNOWN_SCORE;
  const at = Date.parse(publishedAt);
  if (!Number.isFinite(at)) return FRESHNESS_UNKNOWN_SCORE;
  if (at > now + FUTURE_TOLERANCE_MS) return FRESHNESS_UNKNOWN_SCORE;
  const ageDays = Math.max(0, (now - at) / DAY_MS);
  if (ageDays <= FRESHNESS_RECENT_DAYS) return 1;
  if (ageDays <= FRESHNESS_NEAR_DAYS) return 0.8;
  if (ageDays <= FRESHNESS_STALE_DAYS) return 0.55;
  return 0.25;
}

export type ScorePoolOptions = {
  /**
   * True only when this lane actually asked a time-sensitive question. History,
   * foundational theory and classic papers keep the original formula.
   */
  timeSensitive?: boolean;
  now?: number;
};

/**
 * 普通：0.55 relevance + 0.25 authority + 0.20 repeat
 * 时效：0.48 relevance + 0.22 authority + 0.15 repeat + 0.15 freshness
 */
export function scorePool(
  topic: string,
  pool: PooledHit[],
  options: ScorePoolOptions = {},
): ScoredHit[] {
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
  const timeSensitive = options.timeSensitive === true;
  const now = options.now ?? Date.now();

  return pool.map((p, index) => {
    const rrfNorm = rrfRaw[index]! / maxRrf;
    const repeatBoost = Math.min(1, (p.hitCount - 1) / 2);
    const authority = authorityBoost(p.hit.url, topic);
    const score = timeSensitive
      ? 0.48 * rrfNorm +
        0.22 * authority +
        0.15 * repeatBoost +
        0.15 * freshnessScore(p.hit.publishedAt, now)
      : 0.55 * rrfNorm + 0.25 * authority + 0.2 * repeatBoost;
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

  return diversifyBySourceHost(ordered, (row) => row.hit.url, {
    limit: topN,
    maxPerHost: maxPerDomain,
  });
}
