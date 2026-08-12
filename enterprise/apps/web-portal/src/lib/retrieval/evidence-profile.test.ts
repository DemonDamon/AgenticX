import { describe, expect, it } from "vitest";
import { formatEvidenceCoverage, summarizeEvidenceFacet } from "./evidence-profile";

describe("evidence profile", () => {
  it("reports objective host and provider-date coverage", () => {
    const summary = summarizeEvidenceFacet("甲 风评变化", [
      { url: "https://one.example/a", publishedAt: "2026-08-01" },
      { url: "https://two.example/b", publishedAt: "2026-08-10T12:00:00Z" },
    ]);
    expect(summary).toMatchObject({
      selectedHits: 2,
      uniqueHosts: 2,
      datedSources: 2,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
    });
    expect(formatEvidenceCoverage([summary])).toBe("");
  });

  it("does not penalize providers that omit publication metadata", () => {
    const summary = summarizeEvidenceFacet("乙 风评变化", [
      { url: "https://one.example/a" },
      { url: "https://two.example/b" },
    ]);
    expect(summary.datedSources).toBe(0);
    expect(formatEvidenceCoverage([summary])).toBe("");
  });

  it("marks missing facets without repeating their queries", () => {
    const summary = summarizeEvidenceFacet("很长的独立检索问题", []);
    expect(formatEvidenceCoverage([summary])).toContain("子问题 1 无可用来源");
    expect(formatEvidenceCoverage([summary])).not.toContain(summary.query);
  });

  it("warns compactly for a single source host", () => {
    const summary = summarizeEvidenceFacet("趋势问题", [
      { url: "https://one.example/a" },
      { url: "https://one.example/b" },
    ]);
    const warning = formatEvidenceCoverage([summary]);
    expect(warning).toContain("子问题 1 仅 1 个来源域名");
    expect(warning).toContain("正文验证可比时间状态");
    expect(warning).not.toContain(summary.query);
  });
});
