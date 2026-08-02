import { describe, expect, it, vi } from "vitest";
import {
  buildReconBrief,
  formatTodayLine,
  runRecon,
  RECON_BRIEF_MAX_CHARS,
  RECON_RESULTS,
} from "./recon";
import type { WebSearchHit } from "../web-search/providers";

const cfg = { provider: "bocha" as const, apiKey: "k", maxResults: 50 };

function hit(overrides: Partial<WebSearchHit> = {}): WebSearchHit {
  return { title: "标题", url: "https://example.com/a", snippet: "摘要", ...overrides };
}

describe("formatTodayLine", () => {
  it("renders the current date in Asia/Shanghai", () => {
    const line = formatTodayLine(() => Date.parse("2026-08-02T04:00:00Z"));
    expect(line).toContain("2026-08-02");
    expect(line).toContain("训练知识可能已过期");
  });

  it("rolls to the next day for late UTC timestamps", () => {
    const line = formatTodayLine(() => Date.parse("2026-08-02T20:00:00Z"));
    expect(line).toContain("2026-08-03");
  });
});

describe("buildReconBrief", () => {
  it("returns empty string for no hits", () => {
    expect(buildReconBrief([])).toBe("");
  });

  it("includes the published date when the provider supplies one", () => {
    const brief = buildReconBrief([hit({ publishedAt: "2026-07-15T02:00:00Z" })]);
    expect(brief).toContain("2026-07-15");
    expect(brief).toContain("标题");
  });

  it("skips an unparseable published date without breaking the line", () => {
    const brief = buildReconBrief([hit({ publishedAt: "not-a-date" })]);
    expect(brief).toContain("标题 ｜ 摘要");
  });

  it("drops whole trailing entries instead of cutting one in half", () => {
    const long = Array.from({ length: 12 }, (_, i) =>
      hit({ title: `标题${i}`, snippet: "内容".repeat(120) }),
    );
    const brief = buildReconBrief(long);
    expect(brief.length).toBeLessThanOrEqual(RECON_BRIEF_MAX_CHARS);
    const lines = brief.split("\n").slice(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith("- 标题")).toBe(true);
  });
});

describe("runRecon", () => {
  it("caps hits and builds a brief", async () => {
    const searchFn = vi
      .fn()
      .mockResolvedValue(Array.from({ length: 9 }, (_, i) => hit({ title: `T${i}` })));
    const result = await runRecon({
      query: "deepseek v4 核心技术点",
      searchCfg: cfg,
      searchFn: searchFn as never,
    });
    expect(result.hits).toHaveLength(RECON_RESULTS);
    expect(result.brief).toContain("检索到的现状");
    expect(searchFn).toHaveBeenCalledWith("deepseek v4 核心技术点", RECON_RESULTS, cfg, undefined);
  });

  it("swallows search failures so the run continues", async () => {
    const searchFn = vi.fn().mockRejectedValue(new Error("provider down"));
    await expect(
      runRecon({ query: "q", searchCfg: cfg, searchFn: searchFn as never }),
    ).resolves.toEqual({ brief: "", hits: [] });
  });

  it("returns empty when the search outlives the timeout", async () => {
    const searchFn = vi.fn().mockImplementation(() => new Promise(() => {}));
    const result = await runRecon({
      query: "q",
      searchCfg: cfg,
      searchFn: searchFn as never,
      timeoutMs: 5,
    });
    expect(result).toEqual({ brief: "", hits: [] });
  });

  it("skips work for an empty query or an already-aborted signal", async () => {
    const searchFn = vi.fn();
    expect(await runRecon({ query: "  ", searchCfg: cfg, searchFn: searchFn as never })).toEqual({
      brief: "",
      hits: [],
    });
    const aborted = AbortSignal.abort();
    expect(
      await runRecon({ query: "q", searchCfg: cfg, searchFn: searchFn as never, signal: aborted }),
    ).toEqual({ brief: "", hits: [] });
    expect(searchFn).not.toHaveBeenCalled();
  });
});
