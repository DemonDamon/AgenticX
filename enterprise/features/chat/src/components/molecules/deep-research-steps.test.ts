import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { buildDeepResearchSteps } from "./deep-research-steps";

describe("buildDeepResearchSteps", () => {
  it("aggregates lane events into expandable search rows and omits raw clarify spam when answers given", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      { type: "phase", phase: "clarify", message: "正在判断是否需要澄清…" },
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "主要场景？",
        options: [{ id: "a", label: "编程" }],
        allowCustom: true,
      },
      { type: "phase", phase: "plan", message: "正在规划研究路径…" },
      { type: "phase", phase: "lanes", message: "已拆解 1 条调研车道，正在并行检索…" },
      {
        type: "lane_started",
        laneId: "lane-a",
        title: "模型定价",
        index: 1,
        total: 1,
      },
      {
        type: "lane_progress",
        laneId: "lane-a",
        message: "已收集 3 个来源",
        sourcesCollected: 3,
      },
      {
        type: "artifact",
        id: "art1",
        path: "research/r1/lanes/lane-a/memo.md",
        title: "模型定价 · 备忘",
        kind: "memo",
        bytes: 12,
      },
      {
        type: "lane_done",
        laneId: "lane-a",
        artifactPath: "research/r1/lanes/lane-a/memo.md",
        status: "ok",
      },
      { type: "phase", phase: "synthesize", message: "正在综合分析…" },
      {
        type: "artifact",
        id: "art2",
        path: "research/r1/final-report.md",
        title: "终稿",
        kind: "report",
        bytes: 100,
      },
      { type: "phase", phase: "done", message: "完成" },
    ];

    const steps = buildDeepResearchSteps(events, "completed", { q1: "编程" });
    const lanes = steps.filter((s) => s.kind === "lane");
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.title).toBe("搜索网页");
    expect(lanes[0]!.subtitle).toContain("3 个结果");
    expect(lanes[0]!.artifactId).toBe("art1");
    expect(lanes[0]!.detailLines.some((line) => line.includes("备忘"))).toBe(true);

    const clarify = steps.find((s) => s.kind === "clarify");
    expect(clarify?.subtitle).toBe("已收集信息");
    expect(clarify?.detailLines.some((line) => line.includes("编程"))).toBe(true);

    expect(steps.some((s) => s.kind === "artifact" && s.artifactId === "art2")).toBe(true);
    // Memo artifacts are attached to lanes, not duplicated as top-level steps.
    expect(steps.some((s) => s.artifactId === "art1" && s.kind === "artifact")).toBe(false);
  });
});
