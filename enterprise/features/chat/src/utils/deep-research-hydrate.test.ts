import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import {
  deriveDeepResearchSnapshot,
  hydrateMessagesDeepResearch,
  mergeDeepResearchHydrate,
} from "./deep-research-hydrate";

function msg(
  partial: Pick<ChatMessage, "id" | "role" | "content"> & Partial<ChatMessage>,
): ChatMessage {
  return {
    session_id: "s1",
    tenant_id: "t1",
    user_id: "u1",
    created_at: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("deriveDeepResearchSnapshot", () => {
  it("从 research_profile / research_plan 事件派生最新快照", () => {
    const snapshot = deriveDeepResearchSnapshot([
      {
        type: "research_profile",
        runId: "r1",
        researchDepth: "deep",
        clarifyMode: "chat",
        clarifyBudget: { maxRounds: 3, allowMidRun: true },
        planVisibility: "editable",
        assumptions: ["按默认范围研究"],
      },
      {
        type: "research_plan",
        runId: "r1",
        action: "proposed",
        version: 1,
        plan: {
          version: 1,
          objective: "o",
          scope: [],
          subQuestions: [{ id: "sq1", title: "架构" }],
          sourceStrategy: [],
          deliverables: [],
          assumptions: [],
        },
      },
      {
        type: "research_plan",
        runId: "r1",
        action: "updated",
        version: 2,
        plan: {
          version: 2,
          objective: "o",
          scope: [],
          subQuestions: [{ id: "sq1", title: "性能" }],
          sourceStrategy: [],
          deliverables: [],
          assumptions: [],
        },
      },
    ]);
    expect(snapshot.profile?.clarifyMode).toBe("chat");
    expect(snapshot.plan?.version).toBe(2);
    expect(snapshot.planVersion).toBe(2);
    expect(snapshot.plan?.subQuestions[0]?.title).toBe("性能");
    expect(snapshot.assumptions).toEqual(["按默认范围研究"]);
  });

  it("无新事件时返回空对象（旧运行兼容）", () => {
    const snapshot = deriveDeepResearchSnapshot([
      { type: "run_started", runId: "r1" },
      { type: "narrative", text: "x" },
    ]);
    expect(snapshot.profile).toBeUndefined();
    expect(snapshot.plan).toBeUndefined();
    expect(snapshot.planVersion).toBeUndefined();
    expect(snapshot.assumptions).toBeUndefined();
  });
});

describe("mergeDeepResearchHydrate", () => {
  it("hydrate 时附带 profile/plan 快照", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "deepseek v4" }),
      msg({ id: "a1", role: "assistant", content: "摘要" }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-1",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "deepseek v4",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [
        {
          type: "research_profile",
          runId: "run-1",
          researchDepth: "standard",
          clarifyMode: "none",
          clarifyBudget: { maxRounds: 3, allowMidRun: true },
          planVisibility: "hidden",
          assumptions: ["按默认范围研究"],
        },
      ],
    });
    expect(next[1]?.deep_research?.profile?.clarifyMode).toBe("none");
    expect(next[1]?.deep_research?.assumptions).toEqual(["按默认范围研究"]);
  });

  it("attaches latest run events onto the last assistant without workbench", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "deepseek v4" }),
      msg({ id: "a1", role: "assistant", content: "摘要与产物链接" }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-1",
      sessionId: "s1",
      status: "running",
      phase: "synthesize",
      topic: "deepseek v4",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [
        { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
        {
          type: "artifact",
          id: "art-1",
          path: "research/run-1/final-report.md",
          title: "终稿",
          kind: "report",
          bytes: 12,
        },
      ],
    });
    expect(next[1]?.deep_research?.runId).toBe("run-1");
    expect(next[1]?.deep_research?.events).toHaveLength(2);
    expect(next[1]?.deep_research?.status).toBe("completed");
  });

  it("does not overwrite an existing workbench", () => {
    const messages = [
      msg({
        id: "a1",
        role: "assistant",
        content: "x",
        deep_research: {
          runId: "run-existing",
          status: "completed",
          events: [{ type: "phase", phase: "done", message: "ok" }],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-other",
      sessionId: "s1",
      status: "completed",
      phase: "done",
      topic: "t",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [{ type: "narrative", text: "should not attach" }],
    });
    expect(next[0]?.deep_research?.runId).toBe("run-existing");
    expect(next[0]?.deep_research?.events).toHaveLength(1);
  });

  it("overlays stale proposed workbench when run-store shows approved+failed", () => {
    // 重启后聊天历史里只剩 proposed 草案壳，但 run-store 实际已 approved + 跑 lanes + failed。
    const messages = [
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        deep_research: {
          runId: "run-stale",
          status: "awaiting_clarify",
          events: [
            { type: "run_started", runId: "run-stale" },
            {
              type: "research_plan",
              runId: "run-stale",
              action: "proposed",
              version: 1,
              plan: {
                version: 1,
                objective: "移动云盘",
                scope: [],
                subQuestions: [{ id: "sq1", title: "记忆" }],
                sourceStrategy: [],
                deliverables: [],
                assumptions: [],
              },
            },
          ],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-stale",
      sessionId: "s1",
      status: "failed",
      phase: "done",
      topic: "移动云盘",
      updatedAt: "2026-08-06T08:00:00.000Z",
      events: [
        { type: "run_started", runId: "run-stale" },
        {
          type: "research_plan",
          runId: "run-stale",
          action: "approved",
          version: 1,
          plan: {
            version: 1,
            objective: "移动云盘",
            scope: [],
            subQuestions: [{ id: "sq1", title: "记忆" }],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          },
        },
        { type: "phase", phase: "lanes", message: "已拆解" },
        { type: "lane_started", laneId: "q1", title: "记忆" },
        { type: "narrative", text: "研究中断" },
      ],
    });
    expect(next[0]?.deep_research?.status).toBe("failed");
    expect(next[0]?.deep_research?.events).toHaveLength(5);
    // 不再是 proposed 草案 → 前端不会画计划卡
    const lastPlan = next[0]?.deep_research?.events.find(
      (e) => e.type === "research_plan",
    ) as { action: string } | undefined;
    expect(lastPlan?.action).toBe("approved");
  });

  it("mid-run 刷新丢整轮时合成 user+assistant 壳挂载工作台（对话不消失）", () => {
    // 运行还在跑，但该轮从未持久化：历史里只有更早的旧对话。
    const messages = [
      msg({ id: "u-old", role: "user", content: "上周的另一个问题" }),
      msg({ id: "a-old", role: "assistant", content: "旧的回答" }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-mid",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "deepseek v4 核心技术点",
      updatedAt: "2026-08-01T02:00:00.000Z",
      events: [
        { type: "run_started", runId: "run-mid" },
        { type: "phase", phase: "lanes", message: "已拆解 4 条调研车道" },
      ],
    });
    // 不污染旧 assistant；追加合成的 user + assistant。
    expect(next).toHaveLength(4);
    expect(next[1]?.id).toBe("a-old");
    expect(next[1]?.deep_research).toBeUndefined();
    expect(next[2]?.role).toBe("user");
    expect(next[2]?.content).toBe("deepseek v4 核心技术点");
    expect(next[3]?.role).toBe("assistant");
    expect(next[3]?.deep_research?.runId).toBe("run-mid");
    expect(next[3]?.deep_research?.events).toHaveLength(2);
    expect(next[3]?.deep_research?.status).toBe("running");
  });

  it("全新会话首轮 mid-run 刷新：空历史也合成完整一轮", () => {
    const next = mergeDeepResearchHydrate([], {
      runId: "run-first",
      sessionId: "s1",
      status: "awaiting_clarify",
      phase: "clarify",
      topic: "帮我调研向量数据库",
      updatedAt: "2026-08-01T02:00:00.000Z",
      events: [
        { type: "run_started", runId: "run-first" },
        {
          type: "clarify",
          runId: "run-first",
          step: 1,
          total: 1,
          questionId: "q1",
          question: "方向？",
          options: [
            { id: "a", label: "架构" },
            { id: "b", label: "性能" },
          ],
        },
      ],
    });
    expect(next).toHaveLength(2);
    expect(next[0]?.content).toBe("帮我调研向量数据库");
    expect(next[1]?.deep_research?.runId).toBe("run-first");
    expect(next[1]?.deep_research?.status).toBe("awaiting_clarify");
  });

  it("早落库壳 runId=pending 时仍挂载真实 run 工作台（刷新不丢对话）", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "请研究2026年全球表现最优的10个AI模型" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        deep_research: {
          runId: "pending",
          status: "running",
          events: [],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-live",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "请研究2026年全球表现最优的10个AI模型",
      updatedAt: "2026-08-01T02:00:00.000Z",
      events: [
        { type: "run_started", runId: "run-live" },
        { type: "phase", phase: "lanes", message: "已拆解 4 条调研车道" },
      ],
    });
    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe("a1");
    expect(next[1]?.deep_research?.runId).toBe("run-live");
    expect(next[1]?.deep_research?.events).toHaveLength(2);
  });

  it("计划对齐：刷新后执行/终稿不得叠回首张卡，改计划用户话保持中间顺序", () => {
    const reviseText =
      "核心是还要再加多一条，就是这个记忆的产品化落地的过程当中，如何实现性价比高的一个方案";
    const planV1 = {
      version: 1,
      objective: "云盘记忆",
      scope: [] as string[],
      subQuestions: [{ id: "sq1", title: "长期记忆" }],
      sourceStrategy: [] as string[],
      deliverables: [] as string[],
      assumptions: [] as string[],
    };
    const planV2 = {
      ...planV1,
      version: 2,
      subQuestions: [
        { id: "sq1", title: "长期记忆" },
        { id: "sq2", title: "性价比落地" },
      ],
    };
    const messages = [
      msg({
        id: "u1",
        role: "user",
        content: "调研移动云盘记忆",
        created_at: "2026-08-07T00:00:00.000Z",
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "基于OpenClaw内核的分析及产品化方案，下方交付卡片可查看完整内容。",
        created_at: "2026-08-07T00:00:01.000Z",
        deep_research: {
          runId: "run-plan",
          status: "awaiting_clarify",
          events: [
            {
              type: "research_profile",
              runId: "run-plan",
              researchDepth: "deep",
              clarifyMode: "none",
              clarifyBudget: { maxRounds: 3, allowMidRun: true },
              planVisibility: "chat_editable",
              assumptions: [],
            },
            {
              type: "research_plan",
              runId: "run-plan",
              action: "proposed",
              version: 1,
              plan: planV1,
            },
          ],
        },
      }),
      msg({
        id: "u2",
        role: "user",
        content: reviseText,
        created_at: "2026-08-07T00:00:02.000Z",
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-plan",
      sessionId: "s1",
      status: "completed",
      phase: "done",
      topic: "调研移动云盘记忆",
      updatedAt: "2026-08-07T00:10:00.000Z",
      events: [
        {
          type: "research_profile",
          runId: "run-plan",
          researchDepth: "deep",
          clarifyMode: "none",
          clarifyBudget: { maxRounds: 3, allowMidRun: true },
          planVisibility: "chat_editable",
          assumptions: [],
        },
        {
          type: "research_plan",
          runId: "run-plan",
          action: "proposed",
          version: 1,
          plan: planV1,
        },
        { type: "narrative", text: `你：${reviseText}` },
        {
          type: "research_plan",
          runId: "run-plan",
          action: "updated",
          version: 2,
          plan: planV2,
        },
        {
          type: "research_plan",
          runId: "run-plan",
          action: "approved",
          version: 2,
          plan: planV2,
        },
        { type: "phase", phase: "lanes", message: "已拆解 8 条调研车道" },
        { type: "lane_started", laneId: "q1", title: "性价比" },
        {
          type: "artifact",
          id: "art-1",
          kind: "report",
          title: "终稿",
          path: "final-report.md",
        },
        { type: "phase", phase: "done", message: "完成" },
      ],
    });

    expect(next.map((m) => m.id)).toEqual(["u1", "a1", "u2", "dr-assistant-run-plan-exec"]);
    expect(next[1]?.content).toBe("");
    expect(next[1]?.deep_research?.planVersion).toBe(1);
    expect(
      next[1]?.deep_research?.events?.some((e) => e.type === "lane_started"),
    ).toBe(false);
    expect(next[2]?.content).toBe(reviseText);
    expect(next[3]?.deep_research?.status).toBe("completed");
    expect(next[3]?.content).toContain("产品化方案");
    expect(
      next[3]?.deep_research?.events?.some((e) => e.type === "lane_started"),
    ).toBe(true);
  });

  it("计划对齐：已有 v2 卡时全量工作台叠到最新卡，不污染 v1", () => {
    const reviseText = "再加一条性价比";
    const planV1 = {
      version: 1,
      objective: "云盘记忆",
      scope: [] as string[],
      subQuestions: [{ id: "sq1", title: "长期记忆" }],
      sourceStrategy: [] as string[],
      deliverables: [] as string[],
      assumptions: [] as string[],
    };
    const planV2 = {
      ...planV1,
      version: 2,
      subQuestions: [
        { id: "sq1", title: "长期记忆" },
        { id: "sq2", title: "性价比" },
      ],
    };
    const messages = [
      msg({ id: "u1", role: "user", content: "调研云盘记忆" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        deep_research: {
          runId: "run-2",
          status: "awaiting_clarify",
          planVersion: 1,
          events: [
            {
              type: "research_plan",
              runId: "run-2",
              action: "proposed",
              version: 1,
              plan: planV1,
            },
          ],
        },
      }),
      msg({ id: "u2", role: "user", content: reviseText }),
      msg({
        id: "a2",
        role: "assistant",
        content: "已根据你的反馈生成新一版研究计划。",
        deep_research: {
          runId: "run-2",
          status: "awaiting_clarify",
          planVersion: 2,
          events: [
            {
              type: "research_plan",
              runId: "run-2",
              action: "updated",
              version: 2,
              plan: planV2,
            },
          ],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-2",
      sessionId: "s1",
      status: "completed",
      phase: "done",
      topic: "调研云盘记忆",
      updatedAt: "2026-08-07T00:10:00.000Z",
      events: [
        {
          type: "research_profile",
          runId: "run-2",
          researchDepth: "deep",
          clarifyMode: "none",
          clarifyBudget: { maxRounds: 3, allowMidRun: true },
          planVisibility: "chat_editable",
          assumptions: [],
        },
        {
          type: "research_plan",
          runId: "run-2",
          action: "proposed",
          version: 1,
          plan: planV1,
        },
        { type: "narrative", text: `你：${reviseText}` },
        {
          type: "research_plan",
          runId: "run-2",
          action: "updated",
          version: 2,
          plan: planV2,
        },
        {
          type: "research_plan",
          runId: "run-2",
          action: "approved",
          version: 2,
          plan: planV2,
        },
        { type: "lane_started", laneId: "q1", title: "性价比" },
        { type: "phase", phase: "done", message: "完成" },
      ],
    });
    expect(next.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(next[1]?.deep_research?.events?.some((e) => e.type === "lane_started")).toBe(
      false,
    );
    expect(next[3]?.deep_research?.status).toBe("completed");
    expect(next[3]?.deep_research?.events?.some((e) => e.type === "lane_started")).toBe(
      true,
    );
  });

  it("再次 hydrate 不重复合成（合成壳已带工作台事件）", () => {
    const once = mergeDeepResearchHydrate([], {
      runId: "run-first",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "帮我调研向量数据库",
      updatedAt: "2026-08-01T02:00:00.000Z",
      events: [{ type: "run_started", runId: "run-first" }],
    });
    const twice = mergeDeepResearchHydrate(once, {
      runId: "run-first",
      sessionId: "s1",
      status: "running",
      phase: "lanes",
      topic: "帮我调研向量数据库",
      updatedAt: "2026-08-01T02:00:00.000Z",
      events: [{ type: "run_started", runId: "run-first" }],
    });
    expect(twice).toHaveLength(2);
  });
});

describe("hydrateMessagesDeepResearch", () => {
  it("always queries run-store and overlays stale same-run history", async () => {
    const messages = [
      msg({
        id: "a-stale",
        role: "assistant",
        content: "",
        deep_research: {
          runId: "run-stale",
          status: "running",
          events: [{ type: "run_started", runId: "run-stale" }],
        },
      }),
    ];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          latest: {
            runId: "run-stale",
            sessionId: "s1",
            status: "completed",
            phase: "done",
            topic: "研究主题",
            updatedAt: "2026-08-01T01:00:00.000Z",
            events: [
              { type: "run_started", runId: "run-stale" },
              { type: "phase", phase: "done", message: "完成" },
            ],
          },
        },
      }),
    });

    const next = await hydrateMessagesDeepResearch(
      "s1",
      messages,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/chat/deep-research/runs?sessionId=s1&hydrate=1",
      { cache: "no-store" },
    );
    expect(next[0]?.deep_research?.status).toBe("completed");
    expect(next[0]?.deep_research?.events).toHaveLength(2);
  });
});
