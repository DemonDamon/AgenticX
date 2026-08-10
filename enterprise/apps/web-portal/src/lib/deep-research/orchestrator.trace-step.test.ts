import { describe, expect, it, vi } from "vitest";
import { runDeepResearchTurn } from "./orchestrator";

describe("runDeepResearchTurn trace step increment", () => {
  it("keeps trace_id constant and increments x-agenticx-trace-step across gateway calls", async () => {
    const tid = "01JTRACESTEPTEST00000000001";
    const steps: string[] = [];
    const traceIds: string[] = [];
    const stages: string[] = [];

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const step = headers.get("x-agenticx-trace-step") ?? "";
      const traceId = headers.get("x-agenticx-trace-id") ?? "";
      const stage = headers.get("x-agenticx-trace-stage") ?? "";
      steps.push(step);
      traceIds.push(traceId);
      stages.push(stage);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"topic":"t","complexity":"simple","subQuestions":["q1"],"sourceStrategy":[],"deliverables":[],"assumptions":[]}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await runDeepResearchTurn(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "research topic please" }],
        stream: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {
          authorization: "Bearer x",
          "content-type": "application/json",
        },
        traceId: tid,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        awaitClarify: false,
        loadTenantConfig: async () =>
          ({
            enabled: true,
            deepResearchEnabled: true,
            provider: "duckduckgo",
          }) as never,
        executeSearch: async () => [],
        buildPlan: async (deps) => {
          // Force one gateway JSON call via the shared fetchImpl path used by planner.
          await (deps.fetchImpl ?? fetch)(deps.url, {
            method: "POST",
            headers: deps.headers,
            body: JSON.stringify({ model: "gpt-test", stream: false, messages: [] }),
          });
          return {
            topic: "t",
            complexity: "simple" as const,
            subQuestions: ["q1"],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          };
        },
        proposeClarify: async () => ({ needed: false, questions: [] }),
        runReconFn: async () => ({ brief: "", hits: [] }),
        fetchPagesFn: (async () => ({ pages: [], stats: {} })) as never,
        expandQueriesFn: async () => [],
        reflectFn: (async () => []) as never,
        now: () => Date.now(),
      },
    );

    // Drain the stream so the async start() body runs.
    await response.text();

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(new Set(traceIds)).toEqual(new Set([tid]));
    const numeric = steps.map((s) => Number(s));
    expect(numeric.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    expect(new Set(numeric).size).toBe(numeric.length);
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i]).toBeGreaterThan(numeric[i - 1]!);
    }
    expect(stages.some((s) => s === "dr.plan")).toBe(true);
  });
});
