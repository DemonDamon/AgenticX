import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, DeepResearchEvent } from "@agenticx/core-api";
import {
  findActivePlanChatGate,
  isPlanChatGatePending,
  isPlanChatUpdating,
  postPlanChatComposerReply,
  resolveDeepResearchEventTargetAssistantId,
} from "./deep-research-plan-chat-composer";

function planEvent(
  action: "proposed" | "updated" | "approved",
  version = 1,
): DeepResearchEvent {
  return {
    type: "research_plan",
    runId: "run-1",
    action,
    version,
    plan: {
      version,
      objective: "云盘记忆",
      scope: [],
      subQuestions: [{ id: "sq1", title: "长期记忆" }],
      sourceStrategy: [],
      deliverables: [],
      assumptions: [],
    },
  };
}

describe("isPlanChatGatePending", () => {
  it("true for proposed/updated, false after approved or research lanes", () => {
    expect(isPlanChatGatePending([planEvent("proposed")])).toBe(true);
    expect(isPlanChatGatePending([planEvent("proposed"), planEvent("updated", 2)])).toBe(true);
    expect(
      isPlanChatGatePending([planEvent("proposed"), planEvent("approved")]),
    ).toBe(false);
    expect(
      isPlanChatGatePending([
        planEvent("proposed"),
        { type: "lane_started", laneId: "l1", title: "t", index: 1, total: 1 },
      ]),
    ).toBe(false);
  });

  it("ignores recon-cold-start lanes so plan gate stays open after first turn", () => {
    expect(
      isPlanChatGatePending([
        {
          type: "lane_started",
          laneId: "recon-cold-start",
          title: "开题冷启动检索…",
          index: 1,
          total: 1,
        },
        { type: "lane_done", laneId: "recon-cold-start", status: "ok" },
        planEvent("proposed"),
      ]),
    ).toBe(true);
  });
});

describe("isPlanChatUpdating", () => {
  it("busy after updating narrative until next research_plan", () => {
    expect(
      isPlanChatUpdating([
        planEvent("proposed"),
        { type: "narrative", text: "正在根据你的反馈更新计划…" },
      ]),
    ).toBe(true);
    expect(
      isPlanChatUpdating([
        planEvent("proposed"),
        { type: "narrative", text: "正在根据你的反馈更新计划…" },
        planEvent("updated", 2),
      ]),
    ).toBe(false);
  });
});

describe("findActivePlanChatGate", () => {
  it("兜底：无 profile/clarify_chat，只要 plan 未 approved 也命中", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "running",
          events: [planEvent("proposed")],
          artifactIds: [],
        },
      },
    ];
    expect(findActivePlanChatGate(messages, "s1")?.runId).toBe("run-1");
  });

  it("returns gate for chat_editable awaiting plan", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "user",
        content: "调研云盘记忆",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "awaiting_clarify",
          events: [planEvent("proposed")],
          artifactIds: [],
          profile: {
            researchDepth: "standard",
            clarifyMode: "none",
            clarifyBudget: { maxRounds: 3, allowMidRun: true },
            planVisibility: "chat_editable",
            assumptions: [],
          },
          plan: {
            version: 1,
            objective: "云盘记忆",
            scope: [],
            subQuestions: [{ id: "sq1", title: "长期记忆" }],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          },
        },
      },
    ];
    const gate = findActivePlanChatGate(messages, "s1");
    expect(gate?.runId).toBe("run-1");
    expect(gate?.assistantMessageId).toBe("a1");
    expect(gate?.topic).toContain("云盘");
  });

  it("null when plan already approved（编辑后已开跑）", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "running",
          events: [planEvent("proposed"), planEvent("approved")],
          artifactIds: [],
          profile: {
            researchDepth: "standard",
            clarifyMode: "card",
            clarifyBudget: { maxRounds: 3, allowMidRun: true },
            planVisibility: "editable",
            assumptions: [],
          },
        },
      },
    ];
    expect(findActivePlanChatGate(messages, "s1")).toBeNull();
  });

  it("命中：仅有 phase=plan 的 clarify_chat（profile 丢失）", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "running",
          events: [
            planEvent("proposed"),
            {
              type: "clarify_chat",
              runId: "run-1",
              roundIndex: 0,
              phase: "plan",
              promptText: "如需修改…",
            },
          ],
          artifactIds: [],
        },
      },
    ];
    expect(findActivePlanChatGate(messages, "s1")?.runId).toBe("run-1");
  });

  it("仍命中：status 被误打成 running，但 plan gate 事件未结束", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "running",
          events: [
            {
              type: "research_profile",
              runId: "run-1",
              researchDepth: "standard",
              clarifyMode: "none",
              clarifyBudget: { maxRounds: 3, allowMidRun: true },
              planVisibility: "chat_editable",
              assumptions: [],
            },
            planEvent("proposed"),
            {
              type: "clarify_chat",
              runId: "run-1",
              roundIndex: 0,
              phase: "plan",
              promptText: "如需修改可回复…",
            },
            { type: "phase", phase: "plan", message: "等待计划确认" },
          ],
          artifactIds: [],
        },
      },
    ];
    const gate = findActivePlanChatGate(messages, "s1");
    expect(gate?.runId).toBe("run-1");
    expect(gate?.plan.subQuestions[0]?.title).toBe("长期记忆");
  });

  it("两张方案卡时 active gate 指向最新卡，不回落到 v1", () => {
    const profile = {
      researchDepth: "standard" as const,
      clarifyMode: "none" as const,
      clarifyBudget: { maxRounds: 3, allowMidRun: true },
      planVisibility: "chat_editable" as const,
      assumptions: [] as string[],
    };
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:01.000Z",
        deep_research: {
          runId: "run-1",
          status: "awaiting_clarify",
          events: [planEvent("proposed", 1)],
          artifactIds: [],
          profile,
          planVersion: 1,
        },
      },
      {
        id: "a2",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: "2026-01-01T00:00:02.000Z",
        deep_research: {
          runId: "run-1",
          status: "awaiting_clarify",
          events: [planEvent("updated", 2)],
          artifactIds: [],
          profile,
          planVersion: 2,
        },
      },
    ];
    expect(findActivePlanChatGate(messages, "s1")?.assistantMessageId).toBe("a2");
  });
});

describe("resolveDeepResearchEventTargetAssistantId", () => {
  const base = (id: string, runId = "run-1"): ChatMessage => ({
    id,
    session_id: "s1",
    tenant_id: "t",
    user_id: "u",
    role: "assistant",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    deep_research: {
      runId,
      status: "awaiting_clarify",
      events: [planEvent("proposed")],
      artifactIds: [],
    },
  });

  it("车道/批准事件落到同 run 最新方案卡，而非 SSE 首轮 assistantId", () => {
    const messages = [base("a1"), base("a2")];
    const lane: DeepResearchEvent = {
      type: "lane_started",
      runId: "run-1",
      laneId: "l1",
      title: "记忆成本",
      index: 1,
      total: 8,
    };
    expect(resolveDeepResearchEventTargetAssistantId(messages, "a1", lane)).toBe("a2");
    expect(
      resolveDeepResearchEventTargetAssistantId(messages, "a1", {
        type: "research_plan",
        runId: "run-1",
        action: "approved",
        version: 2,
        plan: planEvent("approved", 2).plan!,
      }),
    ).toBe("a2");
  });

  it("research_plan updated 仍锚在流式源消息（供分叉）", () => {
    const messages = [base("a1"), base("a2")];
    expect(
      resolveDeepResearchEventTargetAssistantId(messages, "a1", planEvent("updated", 3)),
    ).toBe("a1");
  });
});

describe("postPlanChatComposerReply", () => {
  it("posts chatReply + planSnapshot and reads returned plan", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          code: "00000",
          data: {
            resumed: true,
            planChat: true,
            version: 2,
            plan: {
              version: 2,
              objective: "云盘记忆",
              scope: [],
              subQuestions: [
                { id: "sq1", title: "长期记忆" },
                { id: "sq2", title: "性价比" },
              ],
              sourceStrategy: [],
              deliverables: [],
              assumptions: [],
            },
          },
        }),
    })) as unknown as typeof fetch;
    const result = await postPlanChatComposerReply({
      runId: "run-1",
      chatReply: "侧重性能",
      plan: {
        version: 1,
        objective: "云盘记忆",
        scope: [],
        subQuestions: [{ id: "sq1", title: "长期记忆" }],
        sourceStrategy: [],
        deliverables: [],
        assumptions: [],
      },
      sessionId: "s1",
      topic: "云盘记忆",
      fetchImpl,
    });
    expect(result.kind).toBe("resumed");
    if (result.kind === "resumed") {
      expect(result.version).toBe(2);
      expect(result.plan?.subQuestions.map((sq) => sq.title)).toEqual(["长期记忆", "性价比"]);
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.chatReply).toBe("侧重性能");
    expect(body.planSnapshot.objective).toBe("云盘记忆");
  });
});
