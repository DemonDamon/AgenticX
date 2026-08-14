import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import {
  buildDeepResearchSegments,
  collectDeepResearchDeliveryArtifacts,
  deepResearchNeedsTrailingActivity,
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
    // Cold-start settled but run still active → trailing dots (no in-card spinner).
    expect(deepResearchNeedsTrailingActivity(segments, "running")).toBe(true);
  });
});

describe("deepResearchNeedsTrailingActivity", () => {
  it("is true after clarify resume narrative while waiting for lanes", () => {
    const events: DeepResearchEvent[] = [
      { type: "narrative", text: "已明确调研方向，开始系统检索。" },
      { type: "phase", phase: "plan", message: "正在规划研究路径…" },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(deepResearchNeedsTrailingActivity(segments, "running")).toBe(true);
  });

  it("is false while a tools card still has a running lane", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "lanes", message: "正在并行检索…" },
      {
        type: "lane_started",
        laneId: "q1",
        title: "架构",
        index: 1,
        total: 1,
      },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(deepResearchNeedsTrailingActivity(segments, "running")).toBe(false);
  });

  it("is false while awaiting clarify answers", () => {
    const events: DeepResearchEvent[] = [
      { type: "narrative", text: "现状已校准，再确认一下调研方向。" },
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "方向？",
        options: [{ id: "a", label: "A" }],
        allowCustom: true,
      },
    ];
    const segments = buildDeepResearchSegments(events, "awaiting_clarify");
    expect(deepResearchNeedsTrailingActivity(segments, "awaiting_clarify")).toBe(false);
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
      // Writing phases collapse into one card; plain "深度研究完成" is omitted.
      "tools",
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

describe("lane_sources", () => {
  it("attaches searched pages to the lane step", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "lanes", message: "已拆解 1 条调研车道，正在并行检索…" },
      { type: "lane_started", laneId: "a", title: "定价", index: 1, total: 1 },
      {
        type: "lane_sources",
        laneId: "a",
        sources: [
          {
            title: "定价页",
            url: "https://example.com/pricing",
            snippet: "每百万 token…",
            archivedPath: "research/r1/pages/pricing_abc123.md",
            fetched: true,
          },
          { title: "对比", url: "https://other.com/compare", fetched: false },
        ],
      },
      { type: "lane_done", laneId: "a", status: "ok" },
    ];
    const segments = buildDeepResearchSegments(events, "completed");
    const tools = segments.find((s) => s.kind === "tools");
    const step = tools && tools.kind === "tools" ? tools.steps[0] : undefined;
    expect(step?.sources).toHaveLength(2);
    expect(step?.sources?.[0]).toMatchObject({
      url: "https://example.com/pricing",
      archivedPath: "research/r1/pages/pricing_abc123.md",
      fetched: true,
    });
  });

  it("ignores sources for an unknown lane", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "lanes", message: "正在并行检索…" },
      { type: "lane_started", laneId: "a", title: "定价", index: 1, total: 1 },
      {
        type: "lane_sources",
        laneId: "ghost",
        sources: [{ title: "x", url: "https://x.com" }],
      },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    const tools = segments.find((s) => s.kind === "tools");
    const step = tools && tools.kind === "tools" ? tools.steps[0] : undefined;
    expect(step?.sources).toBeUndefined();
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
  it("shows the hidden refinement stage as a visible running status", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "lanes", message: "正在并行检索…" },
      { type: "lane_started", laneId: "a", title: "核心表现", index: 1, total: 1 },
      { type: "lane_done", laneId: "a", status: "ok" },
      { type: "phase", phase: "reflect", message: "正在复核并补充关键证据…" },
    ];

    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((segment) => segment.kind)).toEqual(["tools", "status"]);
    const refine = segments[1];
    expect(refine && refine.kind === "status" ? refine : null).toMatchObject({
      title: "正在复核并补充关键证据…",
      status: "running",
    });
    expect(deepResearchNeedsTrailingActivity(segments, "running")).toBe(false);
  });

  it("settles refinement before report writing starts", () => {
    const events: DeepResearchEvent[] = [
      { type: "phase", phase: "reflect", message: "正在复核并补充关键证据…" },
      {
        type: "research_stats",
        queriesPlanned: 3,
        urlsDiscovered: 12,
        sourcesSelected: 6,
        pagesFetched: 2,
      },
      { type: "narrative", text: "证据已就绪，开始撰写报告。" },
      { type: "phase", phase: "synthesize", message: "正在拟定报告大纲…" },
    ];

    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((segment) => segment.kind)).toEqual([
      "status",
      "stats",
      "narrative",
      "tools",
    ]);
    const refine = segments[0];
    expect(refine && refine.kind === "status" ? refine : null).toMatchObject({
      title: "已复核并补充关键证据",
      status: "done",
    });
    const writing = segments[3];
    expect(writing && writing.kind === "tools" ? writing.title : "").toBe("正在撰写报告…");
  });

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

  it("omits zero full-text reads from the stats label", () => {
    const segments = buildDeepResearchSegments(
      [
        {
          type: "research_stats",
          queriesPlanned: 3,
          urlsDiscovered: 12,
          sourcesSelected: 6,
          pagesFetched: 0,
        },
      ],
      "completed",
    );
    const stats = segments[0];
    const label = stats && stats.kind === "stats" ? stats.label : "";

    expect(label).toBe("检索式 3 条 · 发现 12 个来源 · 采用 6 个");
    expect(label).not.toContain("读取正文");
  });

  it("puts the gap card above the follow-up search card", () => {
    const events: DeepResearchEvent[] = [
      {
        type: "reflection",
        gaps: ["缺官方论文", "单一来源未交叉验证"],
      },
      { type: "phase", phase: "lanes", message: "正在针对 2 处缺口补充检索…" },
      { type: "lane_started", laneId: "gap-1", title: "官方论文", index: 1, total: 2 },
      { type: "lane_done", laneId: "gap-1", status: "ok" },
    ];
    const segments = buildDeepResearchSegments(events, "completed");
    expect(segments.map((s) => s.kind)).toEqual(["reflection", "tools"]);
    const tools = segments[1];
    // "正在…" would contradict the check mark once the run settled.
    expect(tools && tools.kind === "tools" ? tools.title : "").toBe(
      "已针对 2 处缺口补充检索",
    );
  });
});

describe("writing phases", () => {
  const writing: DeepResearchEvent[] = [
    { type: "phase", phase: "synthesize", message: "正在拟定报告大纲…" },
    { type: "phase", phase: "synthesize", message: "正在撰写第 1/2 节：核心结论" },
    { type: "phase", phase: "synthesize", message: "正在撰写第 2/2 节：分项分析" },
    { type: "phase", phase: "synthesize", message: "正在综合分析…" },
  ];

  it("collapses into one card and only the live step spins", () => {
    const segments = buildDeepResearchSegments(writing, "running");
    expect(segments.map((s) => s.kind)).toEqual(["tools"]);
    const card = segments[0];
    if (!card || card.kind !== "tools") throw new Error("expected tools card");
    expect(card.title).toBe("正在撰写报告…");
    expect(card.steps.map((s) => [s.title, s.status])).toEqual([
      ["已拟定报告大纲", "done"],
      ["已撰写第 1/2 节：核心结论", "done"],
      ["已撰写第 2/2 节：分项分析", "done"],
      ["正在综合分析…", "running"],
    ]);
  });

  it("rewrites every step to past tense once the run finishes", () => {
    const segments = buildDeepResearchSegments(
      [...writing, { type: "phase", phase: "done", message: "深度研究完成" }],
      "completed",
    );
    expect(segments.map((s) => s.kind)).toEqual(["tools"]);
    const card = segments[0];
    if (!card || card.kind !== "tools") throw new Error("expected tools card");
    expect(card.title).toBe("已完成报告撰写 · 4 步");
    expect(card.steps.every((s) => s.status === "done")).toBe(true);
    expect(card.steps.map((s) => s.title)).toContain("已完成综合分析");
    expect(card.steps.some((s) => s.title.startsWith("正在"))).toBe(false);
  });

  it("fails only the step that was live when the run failed", () => {
    const segments = buildDeepResearchSegments(
      [...writing, { type: "phase", phase: "done", message: "失败" }],
      "failed",
    );
    const card = segments[0];
    if (!card || card.kind !== "tools") throw new Error("expected tools card");
    expect(card.steps.map((s) => s.status)).toEqual(["done", "done", "done", "failed"]);
    // Non-success terminal still surfaces as its own status row.
    expect(segments.map((s) => s.kind)).toEqual(["tools", "status"]);
  });

  it("keeps a partial-finish status when wrap-up degraded", () => {
    const segments = buildDeepResearchSegments(
      [
        ...writing,
        { type: "phase", phase: "done", message: "深度研究完成（部分收尾失败）" },
      ],
      "completed",
    );
    expect(segments.map((s) => s.kind)).toEqual(["tools", "status"]);
    const status = segments[1];
    expect(status && status.kind === "status" ? status.title : "").toContain("部分收尾失败");
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
