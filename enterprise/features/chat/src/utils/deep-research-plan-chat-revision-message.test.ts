import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import {
  buildPlanChatRevisionAssistantMessage,
  freezePlanChatSourceDeepResearch,
  sessionHasPlanChatVersion,
} from "./deep-research-plan-chat-composer";

describe("plan chat revision messages", () => {
  it("buildPlanChatRevisionAssistantMessage creates a new plan_chat bubble", () => {
    const msg = buildPlanChatRevisionAssistantMessage({
      id: "a2",
      sessionId: "s1",
      tenantId: "t1",
      userId: "u1",
      runId: "run-1",
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
    });
    expect(msg.role).toBe("assistant");
    expect(msg.content).toContain("新一版");
    expect(msg.deep_research?.planVersion).toBe(2);
    expect(
      msg.deep_research?.events?.some(
        (e) => e.type === "research_plan" && e.action === "updated" && e.version === 2,
      ),
    ).toBe(true);
  });

  it("freezePlanChatSourceDeepResearch drops newer plans and updating narrative", () => {
    const frozen = freezePlanChatSourceDeepResearch(
      {
        runId: "run-1",
        status: "awaiting_clarify",
        artifactIds: [],
        planVersion: 1,
        plan: {
          version: 1,
          objective: "o",
          scope: [],
          subQuestions: [{ id: "sq1", title: "a" }],
          sourceStrategy: [],
          deliverables: [],
          assumptions: [],
        },
        events: [
          {
            type: "research_plan",
            runId: "run-1",
            action: "proposed",
            version: 1,
            plan: {
              version: 1,
              objective: "o",
              scope: [],
              subQuestions: [{ id: "sq1", title: "a" }],
              sourceStrategy: [],
              deliverables: [],
              assumptions: [],
            },
          },
          { type: "narrative", text: "正在根据你的反馈更新计划…" },
          {
            type: "research_plan",
            runId: "run-1",
            action: "updated",
            version: 2,
            plan: {
              version: 2,
              objective: "o2",
              scope: [],
              subQuestions: [{ id: "sq1", title: "b" }],
              sourceStrategy: [],
              deliverables: [],
              assumptions: [],
            },
          },
        ],
      },
      1,
    );
    expect(frozen.events.some((e) => e.type === "narrative")).toBe(false);
    expect(frozen.events.some((e) => e.type === "research_plan" && e.version === 2)).toBe(
      false,
    );
    expect(frozen.planVersion).toBe(1);
  });

  it("sessionHasPlanChatVersion detects existing revision bubble", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        session_id: "s1",
        tenant_id: "t",
        user_id: "u",
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
        deep_research: {
          runId: "run-1",
          status: "awaiting_clarify",
          artifactIds: [],
          planVersion: 1,
          events: [],
        },
      },
      buildPlanChatRevisionAssistantMessage({
        id: "a2",
        sessionId: "s1",
        tenantId: "t",
        userId: "u",
        runId: "run-1",
        version: 2,
        plan: {
          version: 2,
          objective: "o",
          scope: [],
          subQuestions: [{ id: "sq1", title: "x" }],
          sourceStrategy: [],
          deliverables: [],
          assumptions: [],
        },
      }),
    ];
    expect(sessionHasPlanChatVersion(messages, "s1", "run-1", 2)).toBe(true);
    expect(sessionHasPlanChatVersion(messages, "s1", "run-1", 3)).toBe(false);
  });
});
