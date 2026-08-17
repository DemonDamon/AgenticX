import { describe, expect, it, vi } from "vitest";
import { createMemoryRunStore } from "./run-store";
import { syncRevisePlanChat } from "./plan-chat-revise";

describe("syncRevisePlanChat", () => {
  it("appends updated research_plan and returns new snapshot", async () => {
    const runStore = createMemoryRunStore();
    await runStore.create({
      runId: "run-sync",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "云盘记忆",
    });
    const proposed = {
      version: 1,
      objective: "云盘记忆产品化",
      scope: [] as string[],
      subQuestions: [
        { id: "sq1", title: "长期记忆" },
        { id: "sq2", title: "检索质量" },
      ],
      sourceStrategy: [] as string[],
      deliverables: [] as string[],
      assumptions: ["可经多轮调整"],
    };
    await runStore.appendEvents(
      "run-sync",
      [
        {
          type: "research_plan",
          runId: "run-sync",
          action: "proposed",
          version: 1,
          plan: proposed,
        },
      ],
      { status: "awaiting_clarify", phase: "plan" },
    );
    const run = await runStore.get("t1", "u1", "run-sync");
    expect(run).toBeTruthy();

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: "云盘记忆产品化",
                complexity: "moderate",
                sub_questions: ["长期记忆", "检索质量", "性价比方案"],
              }),
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const revised = await syncRevisePlanChat({
      runStore,
      runId: "run-sync",
      chatReply: "再加一条性价比落地",
      proposedSnapshot: proposed,
      proposedVersion: 1,
      topic: "云盘记忆产品化",
      originalQuery: "云盘记忆产品化",
      priorEvents: run!.events,
      gateway: {
        url: "http://gateway.test/v1/chat/completions",
        headers: { "content-type": "application/json" },
        model: "glm-5.2",
      },
      fetchImpl,
    });

    expect("skippedApprove" in revised).toBe(false);
    expect(revised.version).toBe(2);
    expect(revised.plan.subQuestions.map((sq) => sq.title)).toEqual([
      "长期记忆",
      "检索质量",
      "性价比方案",
    ]);
    const after = await runStore.get("t1", "u1", "run-sync");
    const plans = (after?.events ?? []).filter((e) => e.type === "research_plan");
    expect(plans.at(-1)).toMatchObject({ action: "updated", version: 2 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
