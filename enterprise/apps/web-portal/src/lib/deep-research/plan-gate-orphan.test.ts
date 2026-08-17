import { describe, expect, it } from "vitest";
import {
  isOrphanedPlanGate,
  orphanGateKind,
  parseClientPlanSnapshot,
  snapshotToResearchPlan,
  latestResearchPlanEvent,
} from "./plan-gate-orphan";
import {
  notifyClarifyResume,
  waitForClarifyResume,
} from "./run-wait";
import { createMemoryRunStore, type RunRecord } from "./run-store";

function baseRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-orphan",
    tenantId: "t1",
    userId: "u1",
    sessionId: "s1",
    status: "awaiting_clarify",
    phase: "plan",
    topic: "云盘记忆",
    events: [
      { type: "run_started", runId: "run-orphan" },
      {
        type: "research_plan",
        runId: "run-orphan",
        action: "proposed",
        version: 1,
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
    ],
    reportMarkdown: "",
    citations: [],
    eventSeq: 2,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("plan-gate-orphan", () => {
  it("orphanGateKind detects proposed plan", () => {
    expect(orphanGateKind(baseRun().events)).toBe("plan");
    expect(
      orphanGateKind([
        {
          type: "clarify",
          runId: "r",
          step: 1,
          total: 1,
          questionId: "q1",
          question: "?",
          options: [],
        },
      ]),
    ).toBe("clarify");
  });

  it("isOrphanedPlanGate true when awaiting + proposed + no waiter", () => {
    expect(isOrphanedPlanGate(baseRun())).toBe(true);
  });

  it("isOrphanedPlanGate true for failed/reaped run still on proposed", () => {
    expect(isOrphanedPlanGate(baseRun({ status: "failed", phase: "done" }))).toBe(true);
  });

  it("isOrphanedPlanGate true for running + proposed (desync after restart)", () => {
    expect(isOrphanedPlanGate(baseRun({ status: "running", phase: "plan" }))).toBe(true);
  });

  it("isOrphanedPlanGate false when live waiter exists", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "run-orphan",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "云盘记忆",
    });
    await store.beginClarification("run-orphan", baseRun().events, null);
    const pending = waitForClarifyResume(store, "run-orphan", 0);
    expect(isOrphanedPlanGate(baseRun())).toBe(false);
    await store.resolveClarification({
      tenantId: "t1",
      userId: "u1",
      runId: "run-orphan",
      payload: { answers: {}, skip: true },
    });
    notifyClarifyResume("run-orphan");
    await pending;
  });

  it("isOrphanedPlanGate false after plan approved", () => {
    const run = baseRun();
    const proposed = latestResearchPlanEvent(run.events)!;
    run.events = [
      ...run.events,
      {
        type: "research_plan",
        runId: "run-orphan",
        action: "approved",
        version: 1,
        plan: proposed.plan,
      },
    ];
    expect(isOrphanedPlanGate(run)).toBe(false);
    expect(orphanGateKind(run.events)).toBe(null);
  });

  it("orphanGateKind / isOrphanedPlanGate true for updated plan still in plan_chat gate", () => {
    const run = baseRun();
    const proposed = latestResearchPlanEvent(run.events)!;
    run.events = [
      ...run.events,
      {
        type: "clarify_chat",
        runId: "run-orphan",
        roundIndex: 0,
        phase: "plan",
        promptText: "如需修改可回复…",
      },
      {
        type: "research_plan",
        runId: "run-orphan",
        action: "updated",
        version: 2,
        plan: {
          ...proposed.plan,
          version: 2,
          subQuestions: [{ id: "sq1", title: "性能" }],
        },
      },
    ];
    expect(orphanGateKind(run.events)).toBe("plan");
    expect(isOrphanedPlanGate(run)).toBe(true);
  });

  it("parseClientPlanSnapshot accepts minimal valid plan", () => {
    const snap = parseClientPlanSnapshot({
      version: 1,
      objective: "云盘记忆",
      scope: [],
      subQuestions: [{ id: "sq1", title: "长期记忆" }],
      sourceStrategy: [],
      deliverables: [],
      assumptions: ["假设A"],
    });
    expect(snap?.objective).toBe("云盘记忆");
    expect(snap?.subQuestions).toEqual([{ id: "sq1", title: "长期记忆" }]);
    expect(snap?.assumptions).toEqual(["假设A"]);
  });

  it("parseClientPlanSnapshot rejects empty subQuestions", () => {
    expect(
      parseClientPlanSnapshot({
        version: 1,
        objective: "x",
        subQuestions: [],
      }),
    ).toBeNull();
  });

  it("snapshotToResearchPlan maps subQuestions", () => {
    const latest = latestResearchPlanEvent(baseRun().events)!;
    const plan = snapshotToResearchPlan(latest.plan, "fallback");
    expect(plan.topic).toBe("云盘记忆");
    expect(plan.subQuestions).toEqual(["长期记忆"]);
  });
});
