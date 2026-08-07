import { describe, expect, it } from "vitest";
import {
  SourcePool,
  adaptiveMaxPerDomain,
  authorityBoost,
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
