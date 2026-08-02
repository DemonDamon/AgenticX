import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import {
  buildDeepResearchSegments,
  collectDeepResearchDeliveryArtifacts,
  deepResearchWaitingLabel,
  stripDeepResearchProgressFromContent,
} from "./deep-research-segments";

describe("deepResearchWaitingLabel", () => {
  it("falls back to a startup label before any event lands", () => {
    expect(deepResearchWaitingLabel([])).toBe("正在启动深度研究…");
  });

  it("surfaces the latest phase message while clarify/plan render no segment", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      { type: "phase", phase: "clarify", message: "正在判断是否需要澄清…" },
    ];
    expect(deepResearchWaitingLabel(events)).toBe("正在判断是否需要澄清…");
    expect(buildDeepResearchSegments(events, "running")).toHaveLength(0);
  });

  it("surfaces recon cold-start as a visible search tools card before clarify", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      { type: "narrative", text: "我先快速检索最新公开资料，校准调研前提。" },
      { type: "phase", phase: "recon", message: "正在快速侦查最新现状…" },
      { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
      {
        type: "lane_started",
        laneId: "recon-cold-start",
        title: "deepseek v4 核心技术点",
        index: 1,
        total: 1,
      },
      {
        type: "lane_progress",
        laneId: "recon-cold-start",
        message: "已收集 3 个来源",
        sourcesCollected: 3,
      },
      { type: "lane_done", laneId: "recon-cold-start", status: "ok" },
      { type: "narrative", text: "现状已校准，再确认一下调研方向。" },
    ];
    expect(deepResearchWaitingLabel(events)).toBe("开题冷启动检索…");
    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((s) => s.kind)).toEqual(["narrative", "tools", "narrative"]);
    const tools = segments[1];
    expect(tools && tools.kind === "tools" ? tools.title : "").toContain("开题冷启动");
  });
});

describe("buildDeepResearchSegments", () => {
  it("interleaves narrative → clarify → tools → narrative → status instead of one dump", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      { type: "phase", phase: "clarify", message: "正在判断是否需要澄清…" },
      {
        type: "narrative",
        text: "我先快速确认一下调研方向，然后开始系统检索。",
      },
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "场景？",
        options: [{ id: "a", label: "编程" }],
      },
      { type: "narrative", text: "已明确调研方向，开始系统检索。" },
      { type: "phase", phase: "plan", message: "正在规划研究路径…" },
      { type: "phase", phase: "lanes", message: "已拆解 2 条调研车道，正在并行检索…" },
      {
        type: "lane_started",
        laneId: "a",
        title: "定价",
        index: 1,
        total: 2,
      },
      {
        type: "lane_started",
        laneId: "b",
        title: "基准",
        index: 2,
        total: 2,
      },
      {
        type: "lane_done",
        laneId: "a",
        status: "ok",
        artifactPath: "research/r1/lanes/a/memo.md",
      },
      { type: "lane_done", laneId: "b", status: "ok" },
      { type: "narrative", text: "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。" },
      { type: "phase", phase: "synthesize", message: "正在综合分析…" },
      {
        type: "artifact",
        id: "rep",
        path: "research/r1/final-report.md",
        title: "终稿",
        kind: "report",
        bytes: 10,
      },
      { type: "phase", phase: "done", message: "深度研究完成" },
    ];

    const segments = buildDeepResearchSegments(events, "completed");
    expect(segments.map((s) => s.kind)).toEqual([
      "narrative",
      "clarify",
      "narrative",
      "tools",
      "narrative",
      "status",
      "status",
    ]);

    const tools = segments.find((s) => s.kind === "tools");
    expect(tools && tools.kind === "tools" ? tools.steps : []).toHaveLength(2);
    const toolsTitle = tools && tools.kind === "tools" ? tools.title : "";
    expect(toolsTitle).toContain("2 条调研车道");
    expect(toolsTitle).toContain("已完成");
    expect(toolsTitle).not.toContain("正在并行检索");

    // Planning phases must not appear as separate checklist spam.
    expect(
      segments.some((s) => s.kind === "status" && s.title.includes("规划研究路径")),
    ).toBe(false);

    // Report artifacts are deferred to the delivery strip after the body.
    expect(collectDeepResearchDeliveryArtifacts(events)).toEqual([
      expect.objectContaining({ id: "rep", kind: "report" }),
    ]);
  });

  it("keeps lane memos off the delivery strip", () => {
    const events: DeepResearchEvent[] = [
      {
        type: "lane_started",
        laneId: "a",
        title: "定价",
        index: 1,
        total: 1,
      },
      {
        type: "artifact",
        id: "m1",
        path: "research/r1/lanes/a/memo.md",
        title: "备忘",
        kind: "memo",
        bytes: 4,
      },
      {
        type: "artifact",
        id: "rep",
        path: "research/r1/final-report.md",
        title: "终稿",
        kind: "report",
        bytes: 10,
      },
    ];
    expect(collectDeepResearchDeliveryArtifacts(events).map((a) => a.id)).toEqual(["rep"]);
    const segments = buildDeepResearchSegments(events, "running");
    const tools = segments.find((s) => s.kind === "tools");
    const steps = tools && tools.kind === "tools" ? tools.steps : [];
    expect(steps[0]?.artifactId).toBe("m1");
  });
});

describe("finalizeToolsCardTitle via completed segments", () => {
  it("keeps in-progress title while lanes still running", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "lanes", message: "已拆解 1 条调研车道，正在并行检索…" },
      {
        type: "lane_started",
        laneId: "a",
        title: "定价",
        index: 1,
        total: 1,
      },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    const tools = segments.find((s) => s.kind === "tools");
    expect(tools && tools.kind === "tools" ? tools.title : "").toContain("正在并行检索");
  });
});

describe("reflection / research_stats segments", () => {
  it("renders reflection gaps and stats label", () => {
    const events: DeepResearchEvent[] = [
      {
        type: "reflection",
        gaps: ["缺官方论文", "单一来源未交叉验证"],
      },
      {
        type: "research_stats",
        queriesPlanned: 12,
        urlsDiscovered: 40,
        sourcesSelected: 8,
        pagesFetched: 5,
      },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((s) => s.kind)).toEqual(["reflection", "stats"]);
    const reflection = segments[0];
    expect(reflection && reflection.kind === "reflection" ? reflection.gaps : []).toEqual([
      "缺官方论文",
      "单一来源未交叉验证",
    ]);
    const stats = segments[1];
    expect(stats && stats.kind === "stats" ? stats.label : "").toContain("检索式 12 条");
  });
});

describe("stripDeepResearchProgressFromContent", () => {
  it("removes legacy progress lines from report body", () => {
    const raw = [
      "我先快速确认一下调研方向，然后开始系统检索。",
      "",
      "已明确调研方向，开始系统检索。",
      "",
      "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
      "",
      "# 报告标题",
      "",
      "正文",
    ].join("\n");
    expect(stripDeepResearchProgressFromContent(raw)).toBe("# 报告标题\n\n正文");
  });
});
