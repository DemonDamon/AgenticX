import { describe, expect, it } from "vitest";
import {
  FRESHNESS_UNKNOWN_SCORE,
  SourcePool,
  adaptiveMaxPerDomain,
  authorityBoost,
  entityTokens,
  firstPartyAuthority,
  freshnessScore,
  primaryDomainLabel,
  scorePool,
  selectTopSources,
} from "./source-pool";

describe("SourcePool", () => {
  it("merges utm variants and accumulates hitCount", () => {
    const pool = new SourcePool();
    pool.add(
      { title: "A", url: "https://a.com/x?utm_source=y", snippet: "s" },
      "q1",
    );
    pool.add({ title: "A", url: "https://a.com/x", snippet: "s" }, "q2");
    expect(pool.size).toBe(1);
    const item = pool.list()[0]!;
    expect(item.hitCount).toBe(2);
    expect(item.matchedQueries).toEqual(["q1", "q2"]);
  });
});

describe("authorityBoost / scorePool / selectTopSources", () => {
  it("ranks arxiv above zhihu above random", () => {
    expect(authorityBoost("https://arxiv.org/abs/1")).toBeGreaterThan(
      authorityBoost("https://zhuanlan.zhihu.com/p/1"),
    );
    expect(authorityBoost("https://zhuanlan.zhihu.com/p/1")).toBeGreaterThan(
      authorityBoost("https://random-blog.xyz/a"),
    );
  });

  it("boosts repeated hits in scorePool", () => {
    const pool: ReturnType<SourcePool["list"]> = [
      {
        hit: { title: "once", url: "https://example.com/a", snippet: "deepseek moe" },
        matchedQueries: ["q1"],
        hitCount: 1,
      },
      {
        hit: { title: "thrice", url: "https://example.com/b", snippet: "deepseek moe" },
        matchedQueries: ["q1", "q2", "q3"],
        hitCount: 3,
      },
    ];
    const scored = scorePool("deepseek moe", pool);
    const once = scored.find((s) => s.hit.url.includes("/a"))!;
    const thrice = scored.find((s) => s.hit.url.includes("/b"))!;
    expect(thrice.score).toBeGreaterThan(once.score);
  });

  it("enforces maxPerDomain and returns all when short", () => {
    const scored = Array.from({ length: 5 }, (_, i) => ({
      hit: {
        title: `t${i}`,
        url: `https://same.com/${i}`,
        snippet: "s",
      },
      matchedQueries: ["q"],
      hitCount: 1,
      score: 1 - i * 0.01,
    }));
    expect(selectTopSources(scored, 10, 2)).toHaveLength(2);
    expect(selectTopSources(scored.slice(0, 1), 10, 2)).toHaveLength(1);
  });

  it("represents each host before taking a second page from one host", () => {
    const scored = [
      { hit: { title: "a1", url: "https://a.example/1", snippet: "s" }, score: 1 },
      { hit: { title: "a2", url: "https://a.example/2", snippet: "s" }, score: 0.99 },
      { hit: { title: "b1", url: "https://b.example/1", snippet: "s" }, score: 0.8 },
    ].map((row) => ({ ...row, matchedQueries: ["q"], hitCount: 1 }));

    expect(selectTopSources(scored, 2, 3).map((row) => row.hit.title)).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("relaxes the per-domain quota when the candidate pool is thin", () => {
    expect(adaptiveMaxPerDomain(6)).toBe(5);
    expect(adaptiveMaxPerDomain(12)).toBe(5);
    expect(adaptiveMaxPerDomain(13)).toBe(4);
    expect(adaptiveMaxPerDomain(24)).toBe(4);
    expect(adaptiveMaxPerDomain(40)).toBe(3);
  });

  it("adopts more single-domain pages from a thin pool than the fixed quota did", () => {
    const scored = Array.from({ length: 6 }, (_, i) => ({
      hit: { title: `t${i}`, url: `https://docs.same.com/${i}`, snippet: "s" },
      matchedQueries: ["q"],
      hitCount: 1,
      score: 1 - i * 0.01,
    }));
    expect(selectTopSources(scored, 12, adaptiveMaxPerDomain(scored.length))).toHaveLength(5);
    expect(selectTopSources(scored, 12, 3)).toHaveLength(3);
  });
});

describe("freshnessScore", () => {
  const now = Date.parse("2026-08-15T00:00:00Z");
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it("buckets by age without ever reaching zero", () => {
    expect(freshnessScore(daysAgo(3), now)).toBe(1);
    expect(freshnessScore(daysAgo(30), now)).toBe(1);
    expect(freshnessScore(daysAgo(90), now)).toBe(0.8);
    expect(freshnessScore(daysAgo(400), now)).toBe(0.55);
    expect(freshnessScore(daysAgo(2_000), now)).toBe(0.25);
  });

  it("gives missing, malformed and impossible-future dates the mid band", () => {
    expect(freshnessScore(undefined, now)).toBe(FRESHNESS_UNKNOWN_SCORE);
    expect(freshnessScore("", now)).toBe(FRESHNESS_UNKNOWN_SCORE);
    expect(freshnessScore("not a date", now)).toBe(FRESHNESS_UNKNOWN_SCORE);
    expect(freshnessScore(new Date(now + 400 * 86_400_000).toISOString(), now)).toBe(
      FRESHNESS_UNKNOWN_SCORE,
    );
    // An unknown date must never beat a genuinely recent source.
    expect(freshnessScore(undefined, now)).toBeLessThan(freshnessScore(daysAgo(3), now));
  });
});

describe("time-sensitive scoring", () => {
  const now = Date.parse("2026-08-15T00:00:00Z");
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

  function pooled(url: string, publishedAt?: string) {
    return {
      hit: { title: "挂谷猜想 最新进展", url, snippet: "挂谷猜想 最新进展", publishedAt },
      matchedQueries: ["挂谷猜想 最新进展"],
      hitCount: 1,
    };
  }

  it("leaves a non-recency lane's ordering to relevance and authority", () => {
    const pool = [
      pooled("https://arxiv.org/abs/1501.00001", daysAgo(3_000)),
      pooled("https://blog.example.com/hot-take", daysAgo(2)),
    ];
    const scored = scorePool("挂谷猜想 最新进展", pool, { now });
    const [paper, blog] = scored;

    // A foundational paper is not mechanically outranked by a fresh blog post.
    expect(paper!.score).toBeGreaterThan(blog!.score);
  });

  it("prefers the recent source at equal relevance and authority", () => {
    const pool = [
      pooled("https://news.example.com/old", daysAgo(1_000)),
      pooled("https://news.example.com/new", daysAgo(5)),
    ];
    const scored = scorePool("挂谷猜想 最新进展", pool, { timeSensitive: true, now });
    const byUrl = new Map(scored.map((row) => [row.hit.url, row.score]));

    expect(byUrl.get("https://news.example.com/new")!).toBeGreaterThan(
      byUrl.get("https://news.example.com/old")!,
    );
  });

  it("neither tops nor drops a source with no publication date", () => {
    const pool = [
      pooled("https://news.example.com/undated"),
      pooled("https://news.example.com/new", daysAgo(5)),
      pooled("https://news.example.com/ancient", daysAgo(3_000)),
    ];
    const scored = scorePool("挂谷猜想 最新进展", pool, { timeSensitive: true, now });
    const byUrl = new Map(scored.map((row) => [row.hit.url, row.score]));

    expect(scored).toHaveLength(3);
    expect(byUrl.get("https://news.example.com/undated")!).toBeLessThan(
      byUrl.get("https://news.example.com/new")!,
    );
    expect(byUrl.get("https://news.example.com/undated")!).toBeGreaterThan(
      byUrl.get("https://news.example.com/ancient")!,
    );
  });
});

describe("dynamic first-party authority", () => {
  it("resolves the registrable label through common two-level suffixes", () => {
    expect(primaryDomainLabel("docs.anthropic.com")).toBe("anthropic");
    expect(primaryDomainLabel("developer.acme.co.uk")).toBe("acme");
    expect(primaryDomainLabel("research.example.ac.cn")).toBe("example");
    expect(primaryDomainLabel("example.com")).toBe("example");
  });

  it("drops generic and too-short tokens from the topic", () => {
    const tokens = entityTokens("the latest MiniMax M2 api docs for new models");
    expect(tokens).toContain("minimax");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("api");
    expect(tokens).not.toContain("m2");
  });

  it("boosts a new vendor's own docs on an exact entity match", () => {
    expect(firstPartyAuthority("https://docs.zenith.ai/guide", "zenith 模型定价")).toBe(true);
    expect(authorityBoost("https://docs.zenith.ai/guide", "zenith 模型定价")).toBeGreaterThanOrEqual(
      0.8,
    );
  });

  it("never boosts on a .ai suffix or a self-declared official page", () => {
    expect(authorityBoost("https://randomblog.ai/post", "zenith 模型定价")).toBe(0.2);
    expect(
      authorityBoost("https://official-zenith-news.example.com/docs/x", "zenith 模型定价"),
    ).toBe(0.2);
    // Right entity, but not a primary-material path.
    expect(authorityBoost("https://zenith.ai/press/launch-party", "zenith 模型定价")).toBe(0.2);
    // Primary-material path, but the entity is not in the question.
    expect(authorityBoost("https://docs.other.ai/guide", "zenith 模型定价")).toBe(0.2);
  });

  it("keeps the existing .gov / .edu / arxiv priors intact", () => {
    expect(authorityBoost("https://arxiv.org/abs/2401.00001")).toBe(1);
    expect(authorityBoost("https://nsf.gov/report")).toBe(1);
    expect(authorityBoost("https://mit.edu/paper")).toBe(1);
    expect(authorityBoost("https://zhihu.com/answer/1")).toBe(0.5);
  });
});
