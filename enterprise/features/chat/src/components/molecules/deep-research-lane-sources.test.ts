import { describe, expect, it } from "vitest";
import { laneSourceHost, parseLaneMetrics } from "./deep-research-lane-sources";

describe("laneSourceHost", () => {
  it("strips the www prefix", () => {
    expect(laneSourceHost("https://www.example.com/a/b?c=1")).toBe("example.com");
  });

  it("keeps subdomains", () => {
    expect(laneSourceHost("https://blog.example.co.jp/post")).toBe("blog.example.co.jp");
  });

  it("falls back to the raw string when unparsable", () => {
    expect(laneSourceHost("not a url")).toBe("not a url");
  });
});

describe("parseLaneMetrics", () => {
  it("extracts metrics in a fixed order", () => {
    const lines = [
      "调研子问题：minimax H3 核心技术点",
      "已展开 6 条检索式",
      "发现 49 个候选来源",
      "筛选出 10/49 个高质量来源",
      "已收集 10 个来源，正在读取正文…",
      "已读取 9/10 篇正文（1 请求失败）",
      "备忘：research/r1/lanes/q1/memo.md",
    ];
    expect(parseLaneMetrics(lines).map((m) => m.text)).toEqual([
      "搜索 6 次",
      "找到 49 个网页",
      "采用 10 个",
      "读取正文 9 篇",
    ]);
  });

  it("reports the adopted count, not the shortlist, when the source cap bites", () => {
    // Late lanes shortlist 10 but the run-wide registry is already full.
    const lines = [
      "已展开 2 条检索式",
      "发现 20 个候选来源",
      "筛选出 10/20 个高质量来源",
      "已收集 4 个来源，正在读取正文…",
      "已读取 4/4 篇正文",
    ];
    const metrics = parseLaneMetrics(lines);
    expect(metrics.map((m) => m.text)).toEqual([
      "搜索 2 次",
      "找到 20 个网页",
      "采用 4 个",
      "读取正文 4 篇",
      "已达来源上限",
    ]);
    expect(metrics.at(-1)?.tone).toBe("warning");
  });

  it("shows 采用 0 for a lane that adopted nothing", () => {
    const metrics = parseLaneMetrics([
      "已展开 2 条检索式",
      "发现 20 个候选来源",
      "筛选出 10/20 个高质量来源",
      "已收集 0 个来源，正在读取正文…",
    ]);
    expect(metrics.map((m) => m.text)).toContain("采用 0 个");
    expect(metrics.map((m) => m.text)).toContain("已达来源上限");
  });

  it("counts the queries that actually ran when a lane stops early", () => {
    const metrics = parseLaneMetrics([
      "已展开 4 条检索式",
      "候选已够用，实际检索 2 条，省去 2 条检索式",
      "发现 24 个候选来源",
      "已收集 12 个来源，正在读取正文…",
    ]);
    expect(metrics.map((m) => m.text)).toContain("搜索 2 次");
    expect(metrics.map((m) => m.text)).not.toContain("搜索 4 次");
  });

  it("falls back to the shortlist when no 已收集 line exists", () => {
    expect(
      parseLaneMetrics(["筛选出 7/30 个高质量来源"]).map((m) => m.text),
    ).toEqual(["采用 7 个"]);
  });

  it("skips metrics that never appeared", () => {
    expect(parseLaneMetrics(["发现 3 个候选来源"]).map((m) => m.text)).toEqual([
      "找到 3 个网页",
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseLaneMetrics([])).toEqual([]);
  });
});
