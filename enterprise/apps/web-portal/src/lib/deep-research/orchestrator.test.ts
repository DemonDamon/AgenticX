import { describe, expect, it, vi } from "vitest";
import {
  CHAT_CLARIFY_ANSWER_KEY,
  DEEP_RESEARCH_SEARCH_FAILED,
  MAX_RESULTS_PER_LANE,
  MAX_SOURCES,
  MIN_RESULTS_PER_LANE,
  PLAN_GATE_ACTION_KEY,
  SEARCH_CONCURRENCY,
  expandLanesFromClarifyAnswers,
  filterCitationsForSection,
  formatEvidencePack,
  formatSourcesAppendix,
  mapPool,
  matchSelectedOptions,
  parsePlanPatchSubQuestions,
  resolveResultsPerLane,
  runDeepResearchTurn,
} from "./orchestrator";
import { createMemoryArtifactStore } from "./artifact-store";
import { createMemoryRunStore } from "./run-store";
import {
  clearClarifyWaiters,
  hasLiveClarifyWaiter,
  resolveClarifyResume,
} from "./run-wait";
import type { ResearchPlan } from "./planner";
import type { Citation } from "./registry";
import { emptyFetchStats } from "../web-search/page-fetch";
import { directFetch } from "../web-search/direct-fetch";

async function readSsePayload(response: Response): Promise<{
  text: string;
  raw: string;
  events: Array<Record<string, unknown>>;
  hasSourcesFrame: boolean;
  sourcesCount: number;
}> {
  const raw = await response.text();
  const deltas: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  let hasSourcesFrame = false;
  let sourcesCount = 0;
  for (const block of raw.split("\n\n")) {
    const line = block
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!line) continue;
    const data = line.replace(/^data:\s*/, "");
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        agenticx_deep_research_event?: Record<string, unknown>;
        agenticx_web_search_sources?: unknown;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string") deltas.push(content);
      if (parsed.agenticx_deep_research_event) events.push(parsed.agenticx_deep_research_event);
      if (Array.isArray(parsed.agenticx_web_search_sources)) {
        hasSourcesFrame = true;
        sourcesCount = parsed.agenticx_web_search_sources.length;
      }
    } catch {
      // ignore
    }
  }
  return { text: deltas.join(""), raw, events, hasSourcesFrame, sourcesCount };
}

function synthUpstream(content: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    url: "http://gw/v1/chat/completions",
    headers: {},
    awaitClarify: false,
    artifactStore: createMemoryArtifactStore(),
    tenantId: "t1",
    userId: "u1",
    sessionId: "s1",
    loadTenantConfig: async () => ({
      enabled: true,
      provider: "duckduckgo" as const,
      apiKey: "",
      maxResults: 50,
      deepResearchEnabled: true,
    }),
    proposeClarify: async () => ({ needed: false as const }),
    // Default to a no-op recon so existing assertions stay isolated from cold-start hits.
    runReconFn: async () => ({ brief: "", hits: [] }),
    // Avoid real outbound page fetches in unit tests.
    fetchPagesFn: async (urls: string[]) => ({
      pages: urls.map(() => null),
      stats: emptyFetchStats(),
    }),
    // Avoid real outbound egress probe in unit tests.
    probeEgressFn: async () => true,
    // Keep legacy lane tests at 1 query/lane unless a case opts into multi-variant.
    expandQueriesFn: async ({ subQuestion }: { subQuestion: string }) => [
      { query: subQuestion, kind: "primary" as const },
    ],
    reflectFn: async () => [],
    ...overrides,
  };
}

describe("mapPool concurrency", () => {
  it("never exceeds SEARCH_CONCURRENCY", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5];
    await mapPool(items, SEARCH_CONCURRENCY, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(SEARCH_CONCURRENCY);
  });
});

describe("runDeepResearchTurn", () => {
  it("emits structured events, streams report, and sources frame without gray progress", async () => {
    const plan: ResearchPlan = {
      topic: "主题",
      complexity: "moderate",
      subQuestions: ["子问1", "子问2"],
    };
    let synthBody: Record<string, unknown> | null = null;

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role: string; content?: string }>;
      };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "车道备忘摘要" } }],
          }),
        } as Response;
      }
      synthBody = body as unknown as Record<string, unknown>;
      return synthUpstream("核心结论正文");
    });

    const hits = Array.from({ length: 3 }, (_, i) => ({
      title: `T${i + 1}`,
      url: `https://ex.com/${i + 1}`,
      snippet: `s${i + 1}`,
    }));

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "调研一下" }],
        agenticx_deep_research: true,
      },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => hits,
        }),
      },
    );

    const { text, raw, events, hasSourcesFrame } = await readSsePayload(response);
    expect(raw).not.toContain("> 1/3");
    expect(raw).not.toContain("**来源**");
    // Report body is not streamed into chat; only a completion summary is.
    expect(text).not.toContain("核心结论正文");
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(true);
    expect(text).not.toContain("正在规划研究路径");
    expect(events.some((e) => e.type === "run_started")).toBe(true);
    expect(events.some((e) => e.type === "lane_started")).toBe(true);
    expect(events.some((e) => e.type === "artifact")).toBe(true);
    expect(hasSourcesFrame).toBe(true);
    expect(raw).toContain("[DONE]");

    const messages =
      (synthBody as unknown as { messages?: Array<{ role: string; content?: string }> } | null)
        ?.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("子问1");
    expect(lastUser?.content).toContain("[1]");
  });

  it("refreshes gateway bearer before synthesize so section writes use the new token", async () => {
    const plan: ResearchPlan = {
      topic: "主题",
      complexity: "simple",
      subQuestions: ["子问1"],
    };
    const headers: Record<string, string> = { authorization: "Bearer stale-at-start" };
    const authSeen: string[] = [];
    const refreshAccessToken = vi.fn(async () => ({ accessToken: "fresh-after-search" }));

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const hdrs = (init?.headers ?? {}) as Record<string, string>;
      authSeen.push(String(hdrs.authorization ?? ""));
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"title":"T","sections":[{"id":"s1","title":"核心结论","brief":"b"}]}' } }],
          }),
        } as Response;
      }
      return synthUpstream("section-body");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "调研一下" }] },
      {
        ...baseDeps({
          headers,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => [
            { title: "t", url: "https://ex.com/1", snippet: "s" },
          ],
          refreshAccessToken,
        }),
      },
    );

    await readSsePayload(response);
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(headers.authorization).toBe("Bearer fresh-after-search");
    // At least one Gateway call after refresh must carry the new Bearer
    // (outline JSON and/or section stream).
    expect(authSeen.some((a) => a === "Bearer fresh-after-search")).toBe(true);
  });

  it("clamps total sources to MAX_SOURCES", async () => {
    const plan: ResearchPlan = {
      topic: "T",
      complexity: "complex",
      subQuestions: ["q1", "q2", "q3", "q4", "q5"],
    };

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream("ok");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async (query: string) =>
            Array.from({ length: 10 }, (_, i) => ({
              title: `${query}-${i}`,
              url: `https://ex.com/${query}/${i}`,
              snippet: "s",
            })),
        }),
      },
    );

    const { sourcesCount } = await readSsePayload(response);
    expect(sourcesCount).toBeGreaterThan(0);
    expect(sourcesCount).toBeLessThanOrEqual(MAX_SOURCES);
  });

  it("continues when one lane fails", async () => {
    const plan: ResearchPlan = { topic: "T", complexity: "moderate", subQuestions: ["bad", "good"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream("report");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async (query: string) => {
            if (query === "bad") throw new Error("boom");
            return [{ title: "Ok", url: "https://ok.com", snippet: "s" }];
          },
        }),
      },
    );

    const { text, hasSourcesFrame, events } = await readSsePayload(response);
    // Report body lives in artifacts, not chat text.
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(true);
    expect(hasSourcesFrame).toBe(true);
    expect(text).not.toContain(DEEP_RESEARCH_SEARCH_FAILED);
  });

  it("still completes when finalizeReportArtifacts throws after final-report is written", async () => {
    const store = createMemoryArtifactStore();
    const realWrite = store.write.bind(store);
    vi.spyOn(store, "write").mockImplementation(async (input) => {
      // Only fail P3 deliverables — not final-report.md (which also ends with report.md).
      if (input.path.endsWith("/report.html") || input.path.endsWith("/report.md")) {
        throw new Error("html boom");
      }
      return realWrite(input);
    });
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runId: "run-wrapup-degrade",
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {
              stream?: boolean;
              messages?: Array<{ role: string; content?: string }>;
            };
            if (body.stream === false) {
              const sys = body.messages?.[0]?.content ?? "";
              if (sys.includes("大纲")) {
                return {
                  ok: true,
                  json: async () => ({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            title: "主题调研",
                            sections: [
                              { id: "s1", title: "核心结论", brief: "b1" },
                              { id: "s2", title: "分项分析", brief: "b2" },
                            ],
                          }),
                        },
                      },
                    ],
                  }),
                } as Response;
              }
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("章节正文");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "s" },
          ],
        }),
      },
    );
    const { text, events } = await readSsePayload(response);
    expect(text).not.toContain(DEEP_RESEARCH_SEARCH_FAILED);
    expect(
      events.some(
        (e) =>
          e.type === "phase" &&
          e.phase === "done" &&
          String(e.message).includes("深度研究完成"),
      ),
    ).toBe(true);
    const rows = await store.listByRun("t1", "u1", "run-wrapup-degrade");
    expect(rows.some((r) => r.path.endsWith("final-report.md"))).toBe(true);
    expect(
      events.some((e) => e.type === "narrative" && String(e.text).includes("HTML")),
    ).toBe(true);
  });

  it("emits failure copy when all searches fail", async () => {
    const plan: ResearchPlan = { topic: "T", complexity: "simple", subQuestions: ["a", "b"] };
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn() as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => {
            throw new Error("down");
          },
        }),
      },
    );
    const { text, events } = await readSsePayload(response);
    expect(text).toContain(DEEP_RESEARCH_SEARCH_FAILED);
    expect(events.some((e) => e.type === "phase" && e.phase === "done")).toBe(true);
  });

  it.each([
    {
      label: "non-2xx request rejection",
      code: "90001",
      sectionResponse: () =>
        new Response(
          JSON.stringify({
            error: {
              code: "90001",
              message: "请求触发合规拦截（命中策略: pii-email）",
              hits: [{ rule_id: "pii-email", matched: "private@example.com" }],
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    },
    {
      label: "in-stream response rejection",
      code: "90002",
      sectionResponse: () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  error: {
                    code: "90002",
                    message: "响应触发合规拦截（命中策略: pii-email）",
                    hits: [{ rule_id: "pii-email", matched: "private@example.com" }],
                  },
                })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    },
  ])("stops after the first policy-blocked section without publishing a false report ($label)", async ({
    code,
    sectionResponse,
  }) => {
    const runStore = createMemoryRunStore();
    const runId = `run-policy-blocked-section-${code}`;
    let sectionCalls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role: string; content?: string }>;
      };
      if (body.stream === false) {
        const userText = body.messages?.find((message) => message.role === "user")?.content ?? "";
        if (userText.includes("证据包")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      title: "测试调研",
                      sections: [
                        { id: "s1", title: "核心结论", brief: "结论", citation_indexes: [1], format: "prose" },
                        { id: "s2", title: "分项分析", brief: "分析", citation_indexes: [1], format: "comparison_table" },
                        { id: "s3", title: "不确定性与信息缺口", brief: "缺口", citation_indexes: [1], format: "prose" },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "车道备忘" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      sectionCalls += 1;
      return sectionResponse();
    }) as unknown as typeof fetch;

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "查询某项指标的最新值" }] },
      baseDeps({
        runId,
        runStore,
        fetchImpl,
        buildPlan: async () => ({
          topic: "测试调研",
          complexity: "simple" as const,
          subQuestions: ["指标最新值"],
        }),
        executeSearch: async () => [
          { title: "来源", url: "https://example.com/source", snippet: "公开指标" },
        ],
      }),
    );

    const { text, events, raw } = await readSsePayload(response);
    const row = await runStore.get("t1", "u1", runId);

    expect(sectionCalls).toBe(1);
    expect(row?.status).toBe("failed");
    expect(events.some((event) => event.type === "artifact" && String(event.path).endsWith("final-report.md"))).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "phase", phase: "done", message: "合规策略已拦截报告撰写" }),
    );
    expect(text).toContain("深度研究已停止");
    expect(text).toContain("命中策略: pii-email");
    expect(text).not.toContain("本节撰写失败");
    expect(raw).not.toContain("private@example.com");
    expect(raw).not.toContain('"hits"');
    expect(raw).not.toContain(`"code":"${code}"`);
    expect(text).not.toContain("深度调研完成");
  });

  it("keeps running after transport abort and persists completed run (AC-3)", async () => {
    const controller = new AbortController();
    const runStore = createMemoryRunStore();
    let searchStarts = 0;
    const plan: ResearchPlan = {
      topic: "T",
      complexity: "moderate",
      subQuestions: ["q1", "q2", "q3", "q4"],
    };
    const runId = "runac3transport01";

    const responsePromise = runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          runId,
          runStore,
          signal: controller.signal,
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({
                  choices: [{ message: { content: "memo" } }],
                }),
              } as Response;
            }
            return synthUpstream("报告正文");
          }) as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => {
            searchStarts += 1;
            await new Promise((r) => setTimeout(r, 30));
            return [
              {
                title: "t",
                url: `https://ex.com/${searchStarts}`,
                snippet: "s",
              },
            ];
          },
        }),
      },
    );

    await new Promise((r) => setTimeout(r, 15));
    controller.abort();
    const response = await responsePromise;
    // Transport abort closes further SSE writes; body may be partial — run must still complete.
    await response.text().catch(() => "");
    expect(searchStarts).toBe(plan.subQuestions.length);
    const row = await runStore.get("t1", "u1", runId);
    expect(row?.status).toBe("completed");
    expect(row?.reportMarkdown?.length ?? 0).toBeGreaterThan(0);
  });

  it("survives client cancelling the response body (AC-3 safe close)", async () => {
    const runStore = createMemoryRunStore();
    let searchStarts = 0;
    const plan: ResearchPlan = {
      topic: "T",
      complexity: "moderate",
      subQuestions: ["q1", "q2", "q3", "q4"],
    };
    const runId = "runac3safeclose01";
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const response = await runDeepResearchTurn(
        { model: "m", messages: [{ role: "user", content: "q" }] },
        {
          ...baseDeps({
            runId,
            runStore,
            fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
              const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
              if (body.stream === false) {
                return {
                  ok: true,
                  json: async () => ({
                    choices: [{ message: { content: "memo" } }],
                  }),
                } as Response;
              }
              return synthUpstream("报告正文");
            }) as unknown as typeof fetch,
            buildPlan: async () => plan,
            executeSearch: async () => {
              searchStarts += 1;
              await new Promise((r) => setTimeout(r, 30));
              return [
                {
                  title: "t",
                  url: `https://ex.com/${searchStarts}`,
                  snippet: "s",
                },
              ];
            },
          }),
        },
      );

      // Cancel the body without aborting a transport signal — covers Controller is already closed.
      await response.body!.cancel();

      const deadline = Date.now() + 10_000;
      let row = await runStore.get("t1", "u1", runId);
      while (
        Date.now() < deadline &&
        (!row || row.status === "running" || row.status === "awaiting_clarify")
      ) {
        await new Promise((r) => setTimeout(r, 50));
        row = await runStore.get("t1", "u1", runId);
      }

      expect(row?.status).toBe("completed");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still produces a report when total budget is exhausted after planning", async () => {
    let clock = 0;
    const plan: ResearchPlan = { topic: "T", complexity: "moderate", subQuestions: ["q1", "q2"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "m" } }] }) } as Response;
      }
      return synthUpstream("budget-report");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          now: () => {
            const v = clock;
            clock += 200_000;
            return v;
          },
          buildPlan: async () => plan,
          executeSearch: async () => [{ title: "t", url: "https://ex.com/1", snippet: "s" }],
        }),
      },
    );

    const { text, events, raw } = await readSsePayload(response);
    expect(events.some((e) => e.type === "phase" && e.phase === "synthesize")).toBe(true);
    // Budget-exhausted runs still persist a final report artifact; chat shows summary only.
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(true);
    expect(text).not.toContain("budget-report");
    expect(raw).toContain("[DONE]");
  });

  it("waits for clarify resume before starting lanes", async () => {
    clearClarifyWaiters();
    const plan: ResearchPlan = { topic: "T", complexity: "simple", subQuestions: ["q1"] };
    let lanesStarted = false;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream("after-clarify");
    });

    const responsePromise = runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "模糊问题" }] },
      {
        ...baseDeps({
          awaitClarify: true,
          clarifyTimeoutMs: 5_000,
          runId: "run-clarify-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          proposeClarify: async () => ({
            needed: true as const,
            questions: [
              {
                id: "q1",
                question: "场景？",
                options: [
                  { id: "a", label: "A" },
                  { id: "b", label: "B" },
                ],
              },
            ],
          }),
          buildPlan: async () => {
            lanesStarted = true;
            return plan;
          },
          executeSearch: async () => [{ title: "t", url: "https://ex.com/1", snippet: "s" }],
        }),
      },
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(lanesStarted).toBe(false);
    expect(resolveClarifyResume("run-clarify-1", { answers: { q1: "A" }, skip: false })).toBe(true);
    const response = await responsePromise;
    const { text, events } = await readSsePayload(response);
    expect(lanesStarted).toBe(true);
    expect(events.some((e) => e.type === "clarify")).toBe(true);
    // After clarify resumes, a final report artifact is produced; chat shows summary only.
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(true);
    expect(text).not.toContain("after-clarify");
    clearClarifyWaiters();
  });

  it("writes one memo artifact per successful lane", async () => {
    const store = createMemoryArtifactStore();
    const plan: ResearchPlan = { topic: "T", complexity: "moderate", subQuestions: ["q1", "q2"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo body" } }] }),
        } as Response;
      }
      return synthUpstream("final");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runId: "run-art-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => [{ title: "t", url: "https://ex.com/x", snippet: "s" }],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const artifactEvents = events.filter((e) => e.type === "artifact");
    expect(artifactEvents.length).toBeGreaterThanOrEqual(2);

    const list = await store.listBySession("t1", "u1", "s1");
    const memos = list.filter((a) => a.kind === "memo");
    const reports = list.filter((a) => a.kind === "report");
    expect(memos.length).toBe(2);
    // final-report.md + report.html (no duplicate report.md)
    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports.some((a) => a.path.endsWith("final-report.md"))).toBe(true);
    expect(reports.some((a) => a.path.endsWith("report.html"))).toBe(true);
    expect(reports.some((a) => a.path.endsWith("/report.md") || a.path === "report.md")).toBe(
      false,
    );
  });

  it("delivery prefs decoupled from clarify card: defaults to md, html still secondary", async () => {
    clearClarifyWaiters();
    const store = createMemoryArtifactStore();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "本次调研覆盖 H3 架构与多模态能力。" } }],
          }),
        } as Response;
      }
      return synthUpstream("# 报告\n\n结论 [1]\n");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "minimax h3 核心技术点" }] },
      {
        ...baseDeps({
          awaitClarify: true,
          clarifyTimeoutMs: 5_000,
          artifactStore: store,
          runId: "run-html-prefs",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          proposeClarify: async () => ({ needed: false as const }),
          buildPlan: async () => ({
            topic: "minimax H3 核心技术点",
            complexity: "simple" as const,
            subQuestions: ["架构"],
          }),
          executeSearch: async () => [
            { title: "t", url: "https://ex.com/h3", snippet: "s" },
          ],
        }),
      },
    );

    // 新契约：交付偏好不再以阻塞题混排进澄清卡；无方向问题时直接开跑。
    const { text, events } = await readSsePayload(response);
    expect(
      events.some(
        (e) => e.type === "clarify" && String(e.questionId ?? "").startsWith("q_delivery"),
      ),
    ).toBe(false);
    // 默认 md 主交付；可视化 HTML 仍作为次级产物生成。
    const mdEvent = events.find(
      (e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"),
    );
    const htmlEvent = events.find(
      (e) => e.type === "artifact" && String(e.path).endsWith("report.html"),
    );
    expect(mdEvent).toBeTruthy();
    expect(htmlEvent).toBeTruthy();
    expect(text.trim().length).toBeGreaterThan(0);

    const list = await store.listByRun("t1", "u1", "run-html-prefs");
    expect(list.some((a) => a.path.endsWith("report.html"))).toBe(true);
    expect(list.some((a) => a.path.endsWith("final-report.md"))).toBe(true);
  });
});

describe("recon cold-start", () => {
  function gatewayStub(report = "report") {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream(report);
    });
  }

  it("grounds clarify and plan with today's date plus recon findings", async () => {
    const clarifyDeps: Array<Record<string, unknown>> = [];
    const planDeps: Array<Record<string, unknown>> = [];

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub() as unknown as typeof fetch,
          runReconFn: async () => ({
            brief: "【检索到的现状】- DeepSeek V4 已发布",
            hits: [{ title: "V4 发布", url: "https://recon.example/v4", snippet: "s" }],
          }),
          proposeClarify: async (deps: Record<string, unknown>) => {
            clarifyDeps.push(deps);
            return { needed: false as const };
          },
          buildPlan: async (deps: Record<string, unknown>) => {
            planDeps.push(deps);
            return { topic: "T", complexity: "moderate" as const, subQuestions: ["q1"] };
          },
          executeSearch: async () => [{ title: "t", url: "https://lane.example/1", snippet: "s" }],
        }),
      },
    );

    const { raw, events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "phase" && e.phase === "recon")).toBe(true);
    expect(
      events.some((e) => e.type === "lane_started" && e.laneId === "recon-cold-start"),
    ).toBe(true);
    expect(events.some((e) => e.type === "narrative" && String(e.text).includes("校准调研前提"))).toBe(
      true,
    );

    for (const captured of [clarifyDeps[0], planDeps[0]]) {
      expect(String(captured?.todayLine)).toMatch(/今天是 \d{4}-\d{2}-\d{2}/);
      expect(captured?.reconBrief).toBe("【检索到的现状】- DeepSeek V4 已发布");
    }

    // Recon hits are reused as citable sources rather than thrown away.
    expect(raw).toContain("https://recon.example/v4");
  });

  it("puts recon findings into the evidence pack so their numbers are citable", () => {
    const pack = formatEvidencePack(
      { topic: "主题", complexity: "moderate", subQuestions: ["子问"] },
      [{ question: "子问", citations: [{ index: 2, title: "B", url: "https://b.com", snippet: "sb" }] }],
      [{ index: 1, title: "背景", url: "https://recon.example/v4", snippet: "sa" }],
    );
    expect(pack).toContain("## 背景侦查");
    expect(pack).toContain("[1] 背景");
    expect(pack).toContain("[2] B");
  });

  it("still fans out open-ended asks when clarify is skipped and planner collapses", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("fanout-report") as unknown as typeof fetch,
          // Model over-skips after recon — proposeClarification floor should still ask,
          // but even if the injected clarifier skips, lane breadth must hold.
          proposeClarify: async () => ({ needed: false as const }),
          buildPlan: async () => ({
            topic: "deepseek v4 核心技术点",
            complexity: "simple" as const,
            subQuestions: ["deepseek v4 核心技术点"],
          }),
          executeSearch: async (query: string) => [
            { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const researchLanes = events.filter(
      (e) => e.type === "lane_started" && e.laneId !== "recon-cold-start",
    );
    expect(researchLanes.length).toBeGreaterThanOrEqual(4);
  });

  it("completes the run even when recon throws", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("still-ok") as unknown as typeof fetch,
          runReconFn: async () => {
            throw new Error("recon down");
          },
          buildPlan: async () => ({
            topic: "T",
            complexity: "simple" as const,
            subQuestions: ["q1"],
          }),
          executeSearch: async () => [{ title: "t", url: "https://ex.com/1", snippet: "s" }],
        }),
      },
    );

    const { text, events } = await readSsePayload(response);
    // Recon failure does not block the run; final report is still persisted.
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(true);
    expect(text).not.toContain("still-ok");
  });
});

describe("clarify multi-select → lanes", () => {
  const focusOptions = [
    { id: "a", label: "模型架构创新（如 MoE、注意力机制等）" },
    { id: "b", label: "训练数据与训练/优化方式" },
    { id: "c", label: "推理部署与成本优化" },
    { id: "d", label: "能力评测与典型应用" },
  ];

  it("matches joined multi-select labels even when an option contains 、", () => {
    const answer = focusOptions.map((o) => o.label).join("、");
    expect(matchSelectedOptions(answer, focusOptions)).toEqual(focusOptions.map((o) => o.label));
  });

  it("expands multi-select directions into one lane each", () => {
    const lanes = expandLanesFromClarifyAnswers(
      "deepseek v4 核心技术点",
      [
        {
          id: "q2",
          question: "你更想了解哪些技术方向？（可多选）",
          options: focusOptions,
        },
      ],
      {
        answers: { q2: focusOptions.map((o) => o.label).join("、") },
        skip: false,
      },
    );
    expect(lanes).toHaveLength(4);
    expect(lanes?.[0]).toContain("模型架构创新");
    expect(lanes?.[3]).toContain("能力评测与典型应用");
  });

  it("does not let a slow clarify wait collapse multi-select into one lane", async () => {
    clearClarifyWaiters();
    let clock = 1_000;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream("multi-lane-report");
    });

    const responsePromise = runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          awaitClarify: true,
          clarifyTimeoutMs: 5_000,
          runId: "run-clarify-multiselect",
          now: () => clock,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          proposeClarify: async () => ({
            needed: true as const,
            questions: [
              {
                id: "q2",
                question: "你更想了解哪些技术方向？（可多选）",
                options: focusOptions,
              },
            ],
          }),
          // Planner collapses — multi-select expansion must still win.
          buildPlan: async () => ({
            topic: "T",
            complexity: "simple" as const,
            subQuestions: ["deepseek v4 核心技术点 【用户澄清】 全方向"],
          }),
          executeSearch: async (query: string) => [
            { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
          ],
        }),
      },
    );

    await new Promise((r) => setTimeout(r, 20));
    // Simulate the user thinking for longer than TOTAL_BUDGET_MS while the waiter blocks.
    clock += 200_000;
    expect(
      resolveClarifyResume("run-clarify-multiselect", {
        answers: { q2: focusOptions.map((o) => o.label).join("、") },
        skip: false,
      }),
    ).toBe(true);

    const response = await responsePromise;
    const { events } = await readSsePayload(response);
    const researchLanes = events.filter(
      (e) => e.type === "lane_started" && e.laneId !== "recon-cold-start",
    );
    expect(researchLanes).toHaveLength(4);
    clearClarifyWaiters();
  });
});

describe("adaptive lane count", () => {
  it("spreads the source budget across however many lanes the planner returns", () => {
    expect(resolveResultsPerLane(0)).toBe(MIN_RESULTS_PER_LANE);
    expect(resolveResultsPerLane(2)).toBe(MAX_RESULTS_PER_LANE);
    expect(resolveResultsPerLane(5)).toBe(Math.ceil(MAX_SOURCES / 5));
    expect(resolveResultsPerLane(8)).toBe(Math.ceil(MAX_SOURCES / 8));
    expect(resolveResultsPerLane(40)).toBe(MIN_RESULTS_PER_LANE);
  });

  it("runs one lane per planned sub-question instead of a fixed five", async () => {
    const subQuestions = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];
    const requestedResults: number[] = [];

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("wide-report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "T",
            complexity: "complex" as const,
            subQuestions,
          }),
          executeSearch: async (query: string, maxResults?: number) => {
            requestedResults.push(maxResults ?? -1);
            return [{ title: query, url: `https://ex.com/${query}`, snippet: "s" }];
          },
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const researchLanes = events.filter(
      (e) => e.type === "lane_started" && e.laneId !== "recon-cold-start",
    );
    expect(researchLanes).toHaveLength(subQuestions.length);
    expect(new Set(requestedResults)).toEqual(new Set([resolveResultsPerLane(subQuestions.length)]));
  });

  it("keeps a simple plan narrow instead of padding to five lanes", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("narrow-report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "T",
            complexity: "simple" as const,
            subQuestions: ["only-one", "and-two"],
          }),
          executeSearch: async (query: string) => [
            { title: query, url: `https://ex.com/${query}`, snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const researchLanes = events.filter(
      (e) => e.type === "lane_started" && e.laneId !== "recon-cold-start",
    );
    expect(researchLanes).toHaveLength(2);
  });

  it("announces every planned lane before any lane progress (even when > SEARCH_CONCURRENCY)", async () => {
    // Regression: title said「已拆解 4 条」but only 3 cards showed until a slot freed.
    expect(SEARCH_CONCURRENCY).toBeLessThan(4);
    const subQuestions = ["lane-a", "lane-b", "lane-c", "lane-d"];

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("announce-4-lanes");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "T",
            complexity: "moderate" as const,
            subQuestions,
          }),
          executeSearch: async (query: string) => [
            { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const phaseIdx = events.findIndex(
      (e) =>
        e.type === "phase" &&
        e.phase === "lanes" &&
        typeof e.message === "string" &&
        e.message.includes("4 条"),
    );
    expect(phaseIdx).toBeGreaterThanOrEqual(0);

    const announcedBeforeProgress: string[] = [];
    for (const event of events.slice(phaseIdx + 1)) {
      if (event.type === "lane_started" && event.laneId !== "recon-cold-start") {
        announcedBeforeProgress.push(String(event.laneId));
        continue;
      }
      if (
        event.type === "lane_progress" ||
        event.type === "lane_done" ||
        event.type === "lane_sources"
      ) {
        break;
      }
    }
    expect(announcedBeforeProgress).toHaveLength(4);
  });
});

describe("formatEvidencePack / formatSourcesAppendix", () => {
  it("formats citations", () => {
    const citations: Citation[] = [
      { index: 1, title: "A", url: "https://a.com", snippet: "sa" },
    ];
    const pack = formatEvidencePack(
      { topic: "主题", complexity: "moderate", subQuestions: ["子问"] },
      [{ question: "子问", citations }],
    );
    expect(pack).toContain("研究主题：主题");
    expect(pack).toContain("[1] A");
    expect(pack).toContain("摘要：sa");
    expect(formatSourcesAppendix(citations)).toContain("**来源**");
  });

  it("prefers fullText body in lane evidence", () => {
    const citations: Citation[] = [
      {
        index: 1,
        title: "A",
        url: "https://a.com",
        snippet: "sa",
        fullText: "这是抓取到的全文内容",
      },
    ];
    const pack = formatEvidencePack(
      { topic: "主题", complexity: "moderate", subQuestions: ["子问"] },
      [{ question: "子问", citations }],
    );
    expect(pack).toContain("正文节选：这是抓取到的全文内容");
    expect(pack).not.toContain("摘要：sa");
  });
});

describe("P1 multi-variant + reflect", () => {
  it("runs one search call per expanded variant", async () => {
    const calls: string[] = [];
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("ok");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["q1", "q2"],
          }),
          expandQueriesFn: async ({ subQuestion }: { subQuestion: string }) => [
            { query: subQuestion, kind: "primary" as const },
            { query: `${subQuestion} paper`, kind: "authority" as const },
            { query: `${subQuestion} english`, kind: "english" as const },
          ],
          executeSearch: async (query: string) => {
            calls.push(query);
            return [{ title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" }];
          },
        }),
      },
    );
    await readSsePayload(response);
    expect(calls).toHaveLength(6);
  });

  it("runs gap lanes once when reflect returns gaps", async () => {
    let reflectCalls = 0;
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("ok");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async (query: string) => [
            { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
          ],
          reflectFn: async () => {
            reflectCalls += 1;
            return [
              {
                id: "g1",
                description: "缺官方论文",
                queries: ["official paper"],
              },
            ];
          },
        }),
      },
    );
    const { events } = await readSsePayload(response);
    expect(reflectCalls).toBe(1);
    expect(events.some((e) => e.type === "reflection")).toBe(true);
    expect(events.some((e) => e.type === "lane_started" && e.laneId === "gap-g1")).toBe(true);
    expect(events.some((e) => e.type === "research_stats")).toBe(true);
    // Gap card first, then the follow-up search card — no narrative saying both.
    const reflectionIdx = events.findIndex((e) => e.type === "reflection");
    const followUpIdx = events.findIndex(
      (e) =>
        e.type === "phase" &&
        e.phase === "lanes" &&
        typeof e.message === "string" &&
        e.message.includes("补充检索"),
    );
    const gapLaneIdx = events.findIndex(
      (e) => e.type === "lane_started" && e.laneId === "gap-g1",
    );
    expect(reflectionIdx).toBeGreaterThanOrEqual(0);
    expect(followUpIdx).toBeGreaterThan(reflectionIdx);
    expect(gapLaneIdx).toBeGreaterThan(followUpIdx);
    expect(
      events.some(
        (e) =>
          e.type === "narrative" &&
          typeof e.text === "string" &&
          e.text.includes("信息缺口，正在补充检索"),
      ),
    ).toBe(false);
  });
});

describe("page fetch + sectioned report", () => {
  it("attaches fullText via fetchPagesFn and keeps lane ok when all fetches fail", async () => {
    const responseOk = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {
              stream?: boolean;
              messages?: Array<{ role: string; content?: string }>;
            };
            if (body.stream === false) {
              const sys = body.messages?.[0]?.content ?? "";
              if (sys.includes("大纲")) {
                return {
                  ok: true,
                  json: async () => ({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            title: "主题调研",
                            sections: [
                              { id: "s1", title: "核心结论", brief: "b1" },
                              { id: "s2", title: "分项分析", brief: "b2" },
                              { id: "s3", title: "案例", brief: "b3" },
                              { id: "s4", title: "不确定性与信息缺口", brief: "b4" },
                            ],
                          }),
                        },
                      },
                    ],
                  }),
                } as Response;
              }
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("section-body ");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet-only" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map((url) => ({
              url,
              text: "抓取正文内容".repeat(40),
              rawChars: 400,
              backend: "native" as const,
            })),
            stats: emptyFetchStats(),
          }),
        }),
      },
    );
    const ok = await readSsePayload(responseOk);
    // Chat area shows only a completion summary, not the full report body.
    expect(ok.text).not.toContain("# 主题调研");
    expect(ok.text).not.toContain("## 目录");
    expect((ok.text.match(/^## /gm) ?? []).length).toBeLessThan(2);
    // Final report is still persisted as an artifact.
    expect(
      ok.events.some(
        (e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"),
      ),
    ).toBe(true);
    expect(
      ok.events.some(
        (e) =>
          e.type === "lane_progress" &&
          typeof e.message === "string" &&
          String(e.message).includes("已读取"),
      ),
    ).toBe(true);
    // Lane sources power the docked "searched pages" view.
    const laneSources = ok.events.filter((e) => e.type === "lane_sources");
    expect(laneSources.length).toBeGreaterThan(0);
    const firstSources = (laneSources[0] as { sources: Array<Record<string, unknown>> })
      .sources;
    expect(firstSources.length).toBeGreaterThan(0);
    expect(firstSources[0]).toMatchObject({
      url: "https://example.com/doc",
      fetched: true,
    });

    const responseFail = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("fallback-report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet-only" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map(() => null),
            stats: emptyFetchStats(),
          }),
        }),
      },
    );
    const fail = await readSsePayload(responseFail);
    expect(
      fail.events.some((e) => e.type === "lane_done" && e.status === "ok"),
    ).toBe(true);
    expect(fail.raw).toContain("[DONE]");
  });

  it("does not crash when fetchPagesFn throws", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("ok");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "s" },
          ],
          fetchPagesFn: async () => {
            throw new Error("fetch boom");
          },
        }),
      },
    );
    const { raw, events } = await readSsePayload(response);
    expect(raw).toContain("[DONE]");
    expect(events.some((e) => e.type === "phase" && e.phase === "done")).toBe(true);
  });

  it("emits truncation note when budget is exhausted before sections finish", async () => {
    let nowMs = 1_000_000;
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          now: () => nowMs,
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            // Burn the whole budget during outline so section loop truncates immediately.
            nowMs += 700_000;
            const body = JSON.parse(String(init?.body ?? "{}")) as {
              stream?: boolean;
              messages?: Array<{ role: string; content?: string }>;
            };
            if (body.stream === false) {
              const sys = body.messages?.[0]?.content ?? "";
              if (sys.includes("大纲")) {
                return {
                  ok: true,
                  json: async () => ({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            title: "主题调研",
                            sections: [
                              { id: "s1", title: "核心结论", brief: "b1" },
                              { id: "s2", title: "分项分析", brief: "b2" },
                              { id: "s3", title: "不确定性与信息缺口", brief: "b3" },
                            ],
                          }),
                        },
                      },
                    ],
                  }),
                } as Response;
              }
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("should-not-appear");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "s" },
          ],
        }),
      },
    );
    const { text, raw } = await readSsePayload(response);
    // Truncation note lives in the persisted report, not the chat body.
    expect(text).not.toContain("# 主题调研");
    expect(raw).toContain("[DONE]");
  });

  it("reserves write budget so sections finish after retrieval overruns", async () => {
    const store = createMemoryArtifactStore();
    let nowMs = 1_000_000;
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runId: "run-write-reserve",
          now: () => nowMs,
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {
              stream?: boolean;
              messages?: Array<{ role: string; content?: string }>;
            };
            if (body.stream === false) {
              const sys = body.messages?.[0]?.content ?? "";
              if (sys.includes("大纲")) {
                return {
                  ok: true,
                  json: async () => ({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            title: "主题调研",
                            sections: [
                              { id: "s1", title: "核心结论", brief: "b1" },
                              { id: "s2", title: "分项分析", brief: "b2" },
                              { id: "s3", title: "不确定性与信息缺口", brief: "b3" },
                            ],
                          }),
                        },
                      },
                    ],
                  }),
                } as Response;
              }
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("章节正文");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B", "侧面C"],
          }),
          // Retrieval alone eats past TOTAL_BUDGET_MS - WRITE_RESERVE_MIN_MS.
          executeSearch: async () => {
            nowMs += 500_000;
            return [{ title: "Doc", url: "https://example.com/doc", snippet: "s" }];
          },
        }),
      },
    );
    await readSsePayload(response);
    const rows = await store.listByRun("t1", "u1", "run-write-reserve");
    const report = rows.find((r) => r.path.endsWith("final-report.md"));
    expect(report).toBeDefined();
    expect(report!.content).not.toContain("因时间预算截断");
    expect(report!.content).toContain("不确定性与信息缺口");
  });

  it("archives fetched pages under research/<runId>/pages/", async () => {
    const store = createMemoryArtifactStore();
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runId: "run-archive-1",
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map((url) => ({
              url,
              text: "落盘正文内容".repeat(40),
              rawChars: 400,
              backend: "jina" as const,
            })),
            stats: emptyFetchStats(),
          }),
        }),
      },
    );
    await readSsePayload(response);
    const rows = await store.listByRun("t1", "u1", "run-archive-1");
    expect(rows.some((r) => r.path.startsWith("research/run-archive-1/pages/"))).toBe(true);
  });

  it("includes failure summary in lane_progress when stats non-empty", async () => {
    const stats = emptyFetchStats();
    stats.timeout = 3;
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map(() => null),
            stats,
          }),
        }),
      },
    );
    const { events } = await readSsePayload(response);
    expect(
      events.some(
        (e) =>
          e.type === "lane_progress" &&
          typeof e.message === "string" &&
          String(e.message).includes("超时"),
      ),
    ).toBe(true);
  });

  it("skips page archive when archivePages is false", async () => {
    const store = createMemoryArtifactStore();
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runId: "run-no-archive",
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "duckduckgo",
            apiKey: "",
            maxResults: 50,
            deepResearchEnabled: true,
            archivePages: false,
          }),
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map((url) => ({
              url,
              text: "落盘正文内容".repeat(40),
              rawChars: 400,
              backend: "native" as const,
            })),
            stats: emptyFetchStats(),
          }),
        }),
      },
    );
    await readSsePayload(response);
    const rows = await store.listByRun("t1", "u1", "run-no-archive");
    expect(rows.every((r) => !r.path.includes("/pages/"))).toBe(true);
  });

  it("continues when archivePage write fails", async () => {
    const store = createMemoryArtifactStore();
    const realWrite = store.write.bind(store);
    vi.spyOn(store, "write").mockImplementation(async (input) => {
      if (input.path.includes("/pages/")) {
        throw new Error("archive boom");
      }
      return realWrite(input);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore: store,
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("report");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
          fetchPagesFn: async (urls: string[]) => ({
            pages: urls.map((url) => ({
              url,
              text: "落盘正文内容".repeat(40),
              rawChars: 400,
              backend: "native" as const,
            })),
            stats: emptyFetchStats(),
          }),
        }),
      },
    );
    const { raw, events } = await readSsePayload(response);
    expect(raw).toContain("[DONE]");
    expect(events.some((e) => e.type === "phase" && e.phase === "done")).toBe(true);
    warn.mockRestore();
  });

  it("narrates egress degradation and skips page fetch when egress is blocked", async () => {
    const fetchPagesFn = vi.fn(async (urls: string[]) => ({
      pages: urls.map(() => null),
      stats: emptyFetchStats(),
    }));
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "调研主题" }] },
      {
        ...baseDeps({
          probeEgressFn: async () => false,
          fetchPagesFn,
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("只有散文没有表格");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "调研主题",
            complexity: "moderate" as const,
            subQuestions: ["侧面A"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
        }),
      },
    );
    const { raw, events } = await readSsePayload(response);
    expect(raw).toContain("[DONE]");
    expect(
      events.some(
        (e) =>
          e.type === "narrative" &&
          typeof e.text === "string" &&
          e.text.includes("无法访问外部网站"),
      ),
    ).toBe(true);
    expect(fetchPagesFn).not.toHaveBeenCalled();
  });

  it("probes egress with the outbound fetch, never with the gateway fetchImpl", async () => {
    const gatewayFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      return synthUpstream("正文");
    }) as unknown as typeof fetch;
    const probeArgs: unknown[] = [];

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "调研主题" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayFetch,
          probeEgressFn: async (impl: unknown) => {
            probeArgs.push(impl);
            return true;
          },
          buildPlan: async () => ({
            topic: "调研主题",
            complexity: "moderate" as const,
            subQuestions: ["侧面A"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet" },
          ],
        }),
      },
    );

    await readSsePayload(response);
    expect(probeArgs).toHaveLength(1);
    expect(probeArgs[0]).toBe(directFetch);
    expect(probeArgs[0]).not.toBe(gatewayFetch);
  });

  it("skips section format miss warn for table sections when there is no evidence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("只有散文没有表格");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [],
        }),
      },
    );
    await readSsePayload(response);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("section format miss")),
    ).toBe(false);
    warn.mockRestore();
  });

  it("still warns section format miss for table sections when evidence exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
            if (body.stream === false) {
              return {
                ok: true,
                json: async () => ({ choices: [{ message: { content: "memo" } }] }),
              } as Response;
            }
            return synthUpstream("只有散文没有表格");
          }) as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "主题调研",
            complexity: "moderate" as const,
            subQuestions: ["侧面A", "侧面B"],
          }),
          executeSearch: async () => [
            { title: "Doc", url: "https://example.com/doc", snippet: "snippet about topic" },
          ],
        }),
      },
    );
    await readSsePayload(response);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("section format miss")),
    ).toBe(true);
    warn.mockRestore();
  });
});

describe("interaction policy wiring", { concurrent: false }, () => {
  it("plan_chat: multi-round reply revises plan then approve starts lanes", async () => {
    clearClarifyWaiters();
    const store = createMemoryArtifactStore();
    const runStore = createMemoryRunStore();
    const planCalls: string[] = [];
    let planCall = 0;
    const responsePromise = runDeepResearchTurn(
      {
        model: "m",
        agenticx_deep_research: true,
        agenticx_deep_research_interaction: "plan_chat",
        messages: [{ role: "user", content: "调研一下向量数据库的核心技术点" }],
      },
      baseDeps({
        awaitClarify: true,
        clarifyTimeoutMs: 5_000,
        artifactStore: store,
        runStore,
        runId: "run-plan-chat",
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n\n结论 [1]\n");
        }) as unknown as typeof fetch,
        buildPlan: async ({ userQuery }: { userQuery: string }) => {
          planCalls.push(userQuery);
          planCall += 1;
          if (planCall === 1) {
            return {
              topic: "向量数据库",
              complexity: "moderate" as const,
              subQuestions: ["架构", "生态"],
            };
          }
          return {
            topic: "向量数据库",
            complexity: "moderate" as const,
            subQuestions: ["性能优化", "成本分析"],
          };
        },
        executeSearch: async () => [{ title: "t", url: "https://ex.com", snippet: "s" }],
      }),
    );
    const waitForGate = async (timeoutMs = 5_000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (hasLiveClarifyWaiter("run-plan-chat")) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("plan_chat gate waiter not ready");
    };
    await waitForGate();
    // Round 1: revise plan via chat
    expect(
      resolveClarifyResume("run-plan-chat", {
        answers: { [CHAT_CLARIFY_ANSWER_KEY]: "侧重性能" },
        skip: false,
      }),
    ).toBe(true);
    await waitForGate();
    // Round 2: start research
    expect(
      resolveClarifyResume("run-plan-chat", {
        answers: { [PLAN_GATE_ACTION_KEY]: "approve" },
        skip: false,
      }),
    ).toBe(true);

    const response = await responsePromise;
    const { events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "research_profile" && e.planVisibility === "chat_editable")).toBe(
      true,
    );
    const planEvents = events.filter((e) => e.type === "research_plan");
    expect(planEvents.map((e) => e.action)).toEqual(["proposed", "updated", "approved"]);
    expect(planEvents[1]?.version).toBe(2);
    const updated = planEvents[1]?.plan as { subQuestions: Array<{ title: string }> };
    expect(updated.subQuestions.map((sq) => sq.title)).toEqual(["性能优化", "成本分析"]);
    const planChatPrompts = events.filter(
      (e) => e.type === "clarify_chat" && e.phase === "plan",
    );
    expect(planChatPrompts.length).toBeGreaterThanOrEqual(2);
    expect(planCalls.length).toBeGreaterThanOrEqual(2);
    expect(planCalls[1]).toContain("侧重性能");
    expect(planCalls[1]).toContain("【计划对话】");
  });

  it("narrow factual ask: no clarify events at all, profile mode none", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "这个 API 的发布日期是什么" }] },
      baseDeps({
        runId: "run-narrow",
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n\n2026-08-01 发布 [1]\n");
        }) as unknown as typeof fetch,
        buildPlan: async () => ({
          topic: "发布日期",
          complexity: "simple" as const,
          subQuestions: ["发布日期"],
        }),
        executeSearch: async () => [{ title: "t", url: "https://ex.com", snippet: "s" }],
      }),
    );
    const { events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "clarify")).toBe(false);
    expect(events.some((e) => e.type === "clarify_chat")).toBe(false);
    const profile = events.find((e) => e.type === "research_profile");
    expect(profile?.clarifyMode).toBe("none");
    // research_plan 仍生成（hidden 也落事件）
    expect(events.some((e) => e.type === "research_plan" && e.action === "proposed")).toBe(true);
  });

  it("plan_chat: does not auto-start when clarify timeout would have fired", async () => {
    clearClarifyWaiters();
    let lanesStarted = false;
    const responsePromise = runDeepResearchTurn(
      {
        model: "m",
        agenticx_deep_research_interaction: "plan_chat",
        messages: [{ role: "user", content: "帮我做一份云盘记忆能力调研" }],
      },
      baseDeps({
        awaitClarify: true,
        clarifyTimeoutMs: 80,
        runStore: createMemoryRunStore(),
        runId: "run-plan-no-timeout",
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n");
        }) as unknown as typeof fetch,
        buildPlan: async () => ({
          topic: "云盘记忆",
          complexity: "moderate" as const,
          subQuestions: ["长期记忆", "跨会话个性化"],
        }),
        executeSearch: async () => {
          lanesStarted = true;
          return [{ title: "t", url: "https://ex.com/1", snippet: "s" }];
        },
      }),
    );

    // Far beyond clarifyTimeoutMs — plan gate must still be waiting.
    await new Promise((r) => setTimeout(r, 250));
    expect(lanesStarted).toBe(false);
    expect(hasLiveClarifyWaiter("run-plan-no-timeout")).toBe(true);

    expect(
      resolveClarifyResume("run-plan-no-timeout", {
        answers: { [PLAN_GATE_ACTION_KEY]: "approve" },
        skip: false,
      }),
    ).toBe(true);

    const response = await responsePromise;
    const { events } = await readSsePayload(response);
    expect(
      events.some(
        (e) =>
          e.type === "narrative" &&
          typeof e.text === "string" &&
          e.text.includes("计划确认超时"),
      ),
    ).toBe(false);
    expect(events.some((e) => e.type === "research_plan" && e.action === "approved")).toBe(true);
    expect(lanesStarted).toBe(true);
  });

  it("plan_chat: skip / 直接开始 approves current plan without extra revision", async () => {
    clearClarifyWaiters();
    const searchedQueries: string[] = [];
    const responsePromise = runDeepResearchTurn(
      {
        model: "m",
        agenticx_deep_research_interaction: "plan_chat",
        messages: [{ role: "user", content: "这个 API 的发布日期是什么" }],
      },
      baseDeps({
        awaitClarify: true,
        clarifyTimeoutMs: 5_000,
        runStore: createMemoryRunStore(),
        runId: "run-plan-gate",
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n\n结论 [1]\n");
        }) as unknown as typeof fetch,
        buildPlan: async () => ({
          topic: "发布日期",
          complexity: "simple" as const,
          subQuestions: ["原始子问题"],
        }),
        executeSearch: async (query: string) => {
          searchedQueries.push(query);
          return [{ title: "t", url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" }];
        },
      }),
    );
    {
      const start = Date.now();
      while (Date.now() - start < 5_000 && !hasLiveClarifyWaiter("run-plan-gate")) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    expect(
      resolveClarifyResume("run-plan-gate", {
        answers: { [CHAT_CLARIFY_ANSWER_KEY]: "直接开始" },
        skip: false,
      }),
    ).toBe(true);

    const response = await responsePromise;
    const { events } = await readSsePayload(response);
    const planEvents = events.filter((e) => e.type === "research_plan");
    expect(planEvents.map((e) => e.action)).toEqual(["proposed", "approved"]);
    expect(searchedQueries.some((q) => q.includes("原始子问题"))).toBe(true);
  });

  it("continueFromPlanGate: skips recon/plan wait and searches patched subQuestions", async () => {
    clearClarifyWaiters();
    const runStore = createMemoryRunStore();
    await runStore.create({
      runId: "run-orphan-continue",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "云盘记忆",
    });
    await runStore.appendEvents(
      "run-orphan-continue",
      [
        { type: "run_started", runId: "run-orphan-continue" },
        {
          type: "research_plan",
          runId: "run-orphan-continue",
          action: "updated",
          version: 2,
          plan: {
            version: 2,
            objective: "云盘记忆",
            scope: [],
            subQuestions: [{ id: "sq1", title: "续跑子问题" }],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          },
        },
      ],
      { status: "running", phase: "lanes" },
    );

    const searchedQueries: string[] = [];
    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "云盘记忆" }],
      },
      baseDeps({
        runId: "run-orphan-continue",
        runStore,
        tenantId: "t1",
        userId: "u1",
        sessionId: "s1",
        awaitClarify: false,
        continueFromPlanGate: {
          plan: {
            topic: "云盘记忆",
            complexity: "simple",
            subQuestions: ["续跑子问题"],
          },
          planVersion: 2,
          topic: "云盘记忆",
          planEventEmitted: true,
        },
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n");
        }) as unknown as typeof fetch,
        executeSearch: async (query: string) => {
          searchedQueries.push(query);
          return [{ title: "t", url: "https://ex.com/1", snippet: "s" }];
        },
      }),
    );

    const { events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "run_started")).toBe(false);
    expect(events.some((e) => e.type === "narrative" && String(e.text).includes("恢复中断"))).toBe(
      true,
    );
    expect(searchedQueries.some((q) => q.includes("续跑子问题"))).toBe(true);
    const row = await runStore.get("t1", "u1", "run-orphan-continue");
    expect(row?.events.some((e) => e.type === "run_started")).toBe(true);
  });

  it("midrun clarify: skipped preflight + thin evidence → second card round, constraint reaches reflect", async () => {
    clearClarifyWaiters();
    const reflectTopics: string[] = [];
    const waitForMidrunGate = async () => {
      const start = Date.now();
      while (Date.now() - start < 5_000) {
        if (hasLiveClarifyWaiter("run-midrun")) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("midrun clarify waiter not ready");
    };
    const responsePromise = runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "调研一下向量数据库的核心技术点" }] },
      baseDeps({
        awaitClarify: true,
        clarifyTimeoutMs: 5_000,
        runStore: createMemoryRunStore(),
        runId: "run-midrun",
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
          if (body.stream === false) {
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "memo" } }] }),
            } as Response;
          }
          return synthUpstream("# 报告\n\n结论 [1]\n");
        }) as unknown as typeof fetch,
        proposeClarify: async () => ({
          needed: true as const,
          questions: [
            {
              id: "q_focus",
              question: "方向？",
              options: [
                { id: "a", label: "架构" },
                { id: "b", label: "性能" },
              ],
              allowCustom: true,
            },
          ],
        }),
        buildPlan: async () => ({
          topic: "向量数据库",
          complexity: "moderate" as const,
          subQuestions: ["架构", "性能"],
        }),
        // 所有车道零来源（但不抛错）→ 证据过薄触发 midrun
        executeSearch: async () => [],
        reflectFn: async ({ topic }: { topic: string }) => {
          reflectTopics.push(topic);
          return [];
        },
      }),
    );
    await waitForMidrunGate();
    // preflight：跳过
    expect(resolveClarifyResume("run-midrun", { answers: {}, skip: true })).toBe(true);
    await waitForMidrunGate();
    // midrun：补充约束
    expect(
      resolveClarifyResume("run-midrun", { answers: { q_focus: "性能" }, skip: false }),
    ).toBe(true);

    const response = await responsePromise;
    const { events } = await readSsePayload(response);
    const midrunCards = events.filter((e) => e.type === "clarify" && e.phase === "midrun");
    expect(midrunCards.length).toBeGreaterThan(0);
    expect(midrunCards[0]?.roundIndex).toBe(1);
    expect(reflectTopics.some((t) => t.includes("性能"))).toBe(true);
    const planEvents = events.filter((e) => e.type === "research_plan");
    expect(planEvents.some((e) => e.action === "updated" && e.version === 2)).toBe(true);
  });

  it("parsePlanPatchSubQuestions: whitelist subQuestions only, caps count/length, never throws", () => {
    expect(parsePlanPatchSubQuestions(undefined)).toEqual([]);
    expect(parsePlanPatchSubQuestions("not-json")).toEqual([]);
    expect(parsePlanPatchSubQuestions(JSON.stringify({ subQuestions: "nope" }))).toEqual([]);
    expect(
      parsePlanPatchSubQuestions(
        JSON.stringify({ subQuestions: [" a ", "", 42, "b"], scope: ["evil"] }),
      ),
    ).toEqual(["a", "b"]);
    const many = Array.from({ length: 20 }, (_, i) => `q${i}`);
    expect(parsePlanPatchSubQuestions(JSON.stringify({ subQuestions: many })).length).toBe(8);
  });

  it("filterCitationsForSection: 按 citationIndexes 裁剪，命中无效回退全量", () => {
    const rows = [
      {
        question: "q1",
        citations: [
          { index: 1, title: "t1", url: "https://ex.com/1", snippet: "s1" },
          { index: 2, title: "t2", url: "https://ex.com/2", snippet: "s2" },
        ],
      },
      {
        question: "q2",
        citations: [{ index: 3, title: "t3", url: "https://ex.com/3", snippet: "s3" }],
      },
    ];
    const recon = [{ index: 4, title: "t4", url: "https://ex.com/4", snippet: "s4" }];

    const hit = filterCitationsForSection(rows, recon, [2]);
    expect(hit.fellBack).toBe(false);
    expect(hit.filtered).toHaveLength(1);
    expect(hit.filtered[0]?.citations.map((c) => c.index)).toEqual([2]);
    expect(hit.filteredRecon).toEqual([]);

    // 空索引 → 全量回退（首节/模型未标注场景）
    const empty = filterCitationsForSection(rows, recon, []);
    expect(empty.fellBack).toBe(true);
    expect(empty.filtered).toHaveLength(2);

    // 索引完全不命中 → 全量回退（宁可贵不可错）
    const miss = filterCitationsForSection(rows, recon, [99]);
    expect(miss.fellBack).toBe(true);
    expect(miss.filtered).toHaveLength(2);
  });

  it("分节写作只收到该节 citationIndexes 的证据（token 不再按节数放大）", async () => {
    const sectionPrompts: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role: string; content: string }>;
      };
      if (body.stream === false) {
        const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
        // 大纲调用：返回带 citation_indexes 的两节大纲
        if (user.includes("证据包")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      title: "T",
                      sections: [
                        { id: "s1", title: "核心结论", brief: "b", citation_indexes: [1, 2], format: "prose" },
                        { id: "s2", title: "架构分析", brief: "b", citation_indexes: [1], format: "comparison_table" },
                        { id: "s3", title: "不确定性与信息缺口", brief: "b", citation_indexes: [], format: "prose" },
                      ],
                    }),
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "memo" } }] }),
        } as Response;
      }
      // 分节写作（stream）：记录每节 user prompt
      const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
      if (user.includes("当前章节")) sectionPrompts.push(user);
      return synthUpstream("本节正文 | 维度 | A |\n| --- | --- |\n| x | 1 [1] |");
    }) as unknown as typeof fetch;

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "这个 API 的发布日期是什么" }] },
      baseDeps({
        runId: "run-section-evidence",
        runStore: createMemoryRunStore(),
        fetchImpl,
        buildPlan: async () => ({
          topic: "T",
          complexity: "moderate" as const,
          subQuestions: ["架构", "性能"],
        }),
        executeSearch: async (query: string) => [
          {
            title: query.includes("架构") ? "架构来源" : "性能来源",
            url: `https://ex.com/${encodeURIComponent(query)}`,
            snippet: "s",
          },
        ],
      }),
    );
    await readSsePayload(response);
    // 首节 + 中间节（s3 被 normalize 前可能裁掉；至少有 s2 的裁剪证据）
    const s2Prompt = sectionPrompts.find((p) => p.includes("架构分析"));
    expect(s2Prompt).toBeTruthy();
    // s2 只引用 [1] → 证据包只含第 1 条来源，不含第 2 条
    expect(s2Prompt).toContain("[1]");
    expect(s2Prompt).not.toContain("[2]");
  });
});
