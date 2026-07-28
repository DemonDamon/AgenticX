import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import {
  buildDeepResearchSegments,
  stripDeepResearchProgressFromContent,
} from "./deep-research-segments";

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
      "artifact",
      "status",
    ]);

    const tools = segments.find((s) => s.kind === "tools");
    expect(tools && tools.kind === "tools" ? tools.steps : []).toHaveLength(2);
    expect(tools && tools.kind === "tools" ? tools.title : "").toContain("2 条调研车道");

    // Planning phases must not appear as separate checklist spam.
    expect(
      segments.some((s) => s.kind === "status" && s.title.includes("规划研究路径")),
    ).toBe(false);
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
