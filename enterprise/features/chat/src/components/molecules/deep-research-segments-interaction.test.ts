import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { buildDeepResearchSegments } from "./deep-research-segments";
import { isPlanGatePending } from "./DeepResearchPreflightCard";

const PROFILE: DeepResearchEvent = {
  type: "research_profile",
  runId: "r1",
  researchDepth: "deep",
  clarifyMode: "card",
  clarifyBudget: { maxRounds: 3, allowMidRun: true },
  planVisibility: "editable",
  assumptions: ["按默认范围研究"],
};

const PLAN_V1: DeepResearchEvent = {
  type: "research_plan",
  runId: "r1",
  action: "proposed",
  version: 1,
  plan: {
    version: 1,
    objective: "向量数据库调研",
    scope: [],
    subQuestions: [
      { id: "sq1", title: "架构" },
      { id: "sq2", title: "性能" },
    ],
    sourceStrategy: [],
    deliverables: [],
    assumptions: [],
  },
};

describe("buildDeepResearchSegments · 新事件聚合", () => {
  it("research_profile → clarify_chat → research_plan → tools 按时间线聚合成段", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      PROFILE,
      {
        type: "clarify_chat",
        runId: "r1",
        roundIndex: 0,
        phase: "preflight",
        promptText: "先和你对齐一下…",
      },
      PLAN_V1,
      { type: "phase", phase: "lanes", message: "已拆解 2 条调研车道" },
      { type: "lane_started", laneId: "q1", title: "架构", index: 1, total: 2 },
      { type: "lane_done", laneId: "q1", status: "ok" },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((s) => s.kind)).toEqual(["clarify_chat", "plan", "tools"]);
  });

  it("hidden 计划不渲染 plan 段", () => {
    const events: DeepResearchEvent[] = [
      { ...PROFILE, planVisibility: "hidden" } as DeepResearchEvent,
      PLAN_V1,
      { type: "phase", phase: "lanes", message: "已拆解 2 条调研车道" },
      { type: "lane_started", laneId: "q1", title: "架构", index: 1, total: 2 },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.some((s) => s.kind === "plan")).toBe(false);
  });

  it("chat_editable 渲染 plan_chat 段，并吞掉 phase=plan 的 clarify_chat", () => {
    const events: DeepResearchEvent[] = [
      {
        ...PROFILE,
        clarifyMode: "none",
        planVisibility: "chat_editable",
      } as DeepResearchEvent,
      PLAN_V1,
      {
        type: "clarify_chat",
        runId: "r1",
        roundIndex: 0,
        phase: "plan",
        promptText: "如需修改可回复…",
      },
    ];
    const segments = buildDeepResearchSegments(events, "awaiting_clarify");
    expect(segments.map((s) => s.kind)).toEqual(["plan_chat"]);
  });

  it("同轮 clarify_chat 事件重放只渲染一段；midrun 第 2 轮独立成段", () => {
    const events: DeepResearchEvent[] = [
      {
        type: "clarify_chat",
        runId: "r1",
        roundIndex: 0,
        phase: "preflight",
        promptText: "第一轮",
      },
      {
        type: "clarify_chat",
        runId: "r1",
        roundIndex: 0,
        phase: "preflight",
        promptText: "第一轮（重放）",
      },
      {
        type: "clarify_chat",
        runId: "r1",
        roundIndex: 1,
        phase: "midrun",
        promptText: "第二轮",
      },
    ];
    const segments = buildDeepResearchSegments(events, "running");
    expect(segments.map((s) => s.kind)).toEqual(["clarify_chat", "clarify_chat"]);
    expect(segments[0]?.id).toBe("clarify-chat-0");
    expect(segments[1]?.id).toBe("clarify-chat-1");
  });

  it("旧事件（无 research_profile/research_plan）仍能渲染 clarify 卡片", () => {
    const events: DeepResearchEvent[] = [
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "方向？",
        options: [
          { id: "a", label: "架构" },
          { id: "b", label: "性能" },
        ],
      },
    ];
    const segments = buildDeepResearchSegments(events, "awaiting_clarify");
    expect(segments.map((s) => s.kind)).toEqual(["clarify"]);
  });
});

describe("isPlanGatePending", () => {
  it("最新 research_plan 为 proposed → true；approved/updated → false", () => {
    expect(isPlanGatePending([PLAN_V1])).toBe(true);
    expect(isPlanGatePending([PLAN_V1, { ...PLAN_V1, action: "approved" }])).toBe(false);
    expect(isPlanGatePending([PLAN_V1, { ...PLAN_V1, action: "updated", version: 2 }])).toBe(
      false,
    );
    expect(isPlanGatePending([])).toBe(false);
  });
});
