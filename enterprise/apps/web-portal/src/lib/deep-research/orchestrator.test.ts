import { describe, expect, it, vi } from "vitest";
import {
  DEEP_RESEARCH_SEARCH_FAILED,
  MAX_LANES,
  EARLY_STOP_PROBE_VARIANTS,
  LANE_ADOPT_CAP,
  MAX_RESULTS_PER_LANE,
  MAX_SOURCES,
  MIN_RESULTS_PER_LANE,
  SEARCH_CONCURRENCY,
  expandLanesFromClarifyAnswers,
  formatEvidencePack,
  formatSourcesAppendix,
  mapPool,
  matchSelectedOptions,
  resolveLaneAdoptCap,
  resolveResultsPerLane,
  runDeepResearchTurn,
} from "./orchestrator";
import { createMemoryArtifactStore } from "./artifact-store";
import { createMemoryRunStore } from "./run-store";
import { clearClarifyWaiters, resolveClarifyResume } from "./run-wait";
import type { PlannerDeps, ResearchPlan } from "./planner";
import type { ReconDeps } from "./recon";
import type { Citation } from "./registry";
import { emptyFetchStats } from "../web-search/page-fetch";
import { directFetch } from "../web-search/direct-fetch";
import type { executeWebSearch } from "../web-search/providers";
import type { DirectPageView } from "../web-search/direct-page";
import { MAX_FOLLOWUP_QUERIES, MAX_REFLECT_ROUNDS } from "./reflector";

type ExecuteSearchArgs = Parameters<typeof executeWebSearch>;

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
  it("reads an explicit page once and reuses question-ranked passages across lanes", async () => {
    const gatewayBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      gatewayBodies.push(body);
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "lane memo" } }] }),
        } as Response;
      }
      return synthUpstream("report");
    });
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "Paper title",
      text: [
        "Paper title and abstract.",
        "Introduction and background.",
        "Method section.",
        "Table 8: R&D coding benchmark.",
        "Pass Rate Internal Engineers 80 percent.",
      ].join("\n\n"),
      rawChars: 180,
      coverage: "full_html",
      backend: "native",
    }));
    const fetchPagesFn = vi.fn(async (urls: string[]) => ({
      pages: urls.map(() => null),
      stats: emptyFetchStats(),
    }));
    const runReconFn = vi.fn(async (_deps: ReconDeps) => ({ brief: "", hits: [] }));
    const buildPlan = vi.fn(async (_deps: PlannerDeps) => ({
      topic: "Paper",
      complexity: "simple" as const,
      subQuestions: ["Table 8 Pass Rate"],
    }));

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [
          {
            role: "user",
            content: "https://arxiv.org/pdf/2606.19348你能读懂这篇文章嘛?",
          },
        ],
        agenticx_deep_research: true,
      },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          readPage,
          fetchPagesFn,
          runReconFn,
          buildPlan,
          executeSearch: async () => [
            {
              title: "duplicate paper",
              url: "https://arxiv.org/abs/2606.19348v1",
              snippet: "duplicate",
            },
            { title: "external", url: "https://example.com/context", snippet: "context" },
          ],
        }),
      },
    );

    await readSsePayload(response);
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({
      readUrl: "https://arxiv.org/html/2606.19348",
      question: "你能读懂这篇文章嘛?",
    });
    expect(runReconFn.mock.calls[0]?.[0]?.query).toBe(
      "深度解读《Paper title》：核心创新、方法论、关键实验与结论",
    );
    expect(runReconFn.mock.calls[0]?.[0]?.query).not.toContain("https://");
    expect(buildPlan.mock.calls[0]?.[0]?.userQuery).toContain("《Paper title》");
    expect(buildPlan.mock.calls[0]?.[0]?.userQuery).not.toContain("如何读懂");
    expect(fetchPagesFn).toHaveBeenCalled();
    const pageFetchUrls = fetchPagesFn.mock.calls.flatMap((call) => call[0]);
    expect(pageFetchUrls.length).toBeGreaterThan(0);
    expect(new Set(pageFetchUrls)).toEqual(new Set(["https://example.com/context"]));
    expect(JSON.stringify(gatewayBodies)).toContain("Table 8: R&D coding benchmark");
    expect(JSON.stringify(gatewayBodies)).toContain("Pass Rate Internal Engineers 80 percent");
  });

  it("keeps a unique historical paper identity in recon and planning for a follow-up", async () => {
    const runReconFn = vi.fn(async (_deps: ReconDeps) => ({ brief: "", hits: [] }));
    const clarifyDeps: Array<Record<string, unknown>> = [];
    const proposeClarify = async (deps: Record<string, unknown>) => {
      clarifyDeps.push(deps);
      return { needed: false as const };
    };
    const buildPlan = vi.fn(async (_deps: PlannerDeps) => ({
      topic: "论文局限",
      complexity: "simple" as const,
      subQuestions: ["arXiv 2606.19348 的局限"],
    }));
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "lane memo" } }] }),
        } as Response;
      }
      return synthUpstream("report");
    });

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "https://arxiv.org/pdf/2606.19348 你能读懂这篇文章吗？" },
          { role: "assistant", content: "可以，下面是论文概览。" },
          { role: "user", content: "那这篇文章的局限性是什么？" },
        ],
        agenticx_deep_research: true,
      },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          runReconFn,
          proposeClarify,
          buildPlan,
          readPage: async (reference: DirectPageView["reference"]): Promise<DirectPageView> => ({
            reference,
            title: "Paper",
            text: "Abstract. Limitations include evaluation scope and benchmark coverage.",
            rawChars: 72,
            coverage: "full_html",
            backend: "native",
          }),
          executeSearch: async () => [],
        }),
      },
    );

    await readSsePayload(response);
    const groundedQuery = "围绕《Paper》研究：那这篇文章的局限性是什么？";
    expect(runReconFn.mock.calls[0]?.[0]?.query).toBe(groundedQuery);
    expect(clarifyDeps[0]?.userQuery).toBe(groundedQuery);
    expect(buildPlan.mock.calls[0]?.[0]?.userQuery).toContain(groundedQuery);
    expect(runReconFn.mock.calls[0]?.[0]?.query).not.toContain("https://");
  });

  it("reuses uploaded document identity for routing and its body only as lane evidence", async () => {
    const sentinel = "UNIQUE_UPLOADED_DOCUMENT_EVIDENCE_SENTINEL";
    const groundedQuery =
      "深度解读《Reliable Agents Under Partial Observability》：核心创新、方法论、关键实验与结论";
    const gatewayBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      gatewayBodies.push(body);
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "lane memo" } }] }),
        } as Response;
      }
      return synthUpstream("report");
    });
    const runReconFn = vi.fn(async (_deps: ReconDeps) => ({ brief: "", hits: [] }));
    const clarifyQueries: string[] = [];
    const proposeClarify = vi.fn(async (deps: { userQuery: string }) => {
      clarifyQueries.push(deps.userQuery);
      return { needed: false as const };
    });
    const buildPlan = vi.fn(async (_deps: PlannerDeps) => ({
      topic: "Reliable Agents",
      complexity: "simple" as const,
      subQuestions: ["这篇论文的方法和实验结论"],
    }));
    const fetchPagesFn = vi.fn(async (urls: string[]) => ({
      pages: urls.map(() => null),
      stats: emptyFetchStats(),
    }));
    const readPage = vi.fn(async () => null);

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [
          {
            role: "user",
            content: [
              "你能读懂这个文件吗？",
              "",
              "--- 附件: research.pdf ---",
              "Reliable Agents Under Partial Observability",
              "Abstract and methodology.",
              "Project page: https://malicious.example/inside-upload",
              `The evaluation reports ${sentinel} in Table 8.`,
            ].join("\n"),
          },
        ],
        agenticx_deep_research: true,
      },
      {
        ...baseDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          runReconFn,
          proposeClarify,
          buildPlan,
          readPage,
          fetchPagesFn,
          executeSearch: async () => [
            {
              title: "external verification",
              url: "https://example.com/verification",
              snippet: "external context",
            },
          ],
        }),
      },
    );

    const result = await readSsePayload(response);
    expect(runReconFn.mock.calls[0]?.[0]?.query).toBe(groundedQuery);
    expect(readPage).not.toHaveBeenCalled();
    expect(clarifyQueries[0]).toBe(groundedQuery);
    expect(buildPlan.mock.calls[0]?.[0]?.userQuery).toContain(groundedQuery);
    expect(runReconFn.mock.calls[0]?.[0]?.query).not.toContain(sentinel);
    expect(buildPlan.mock.calls[0]?.[0]?.userQuery).not.toContain(sentinel);
    expect(JSON.stringify(gatewayBodies)).toContain(sentinel);
    const fetchedUrls = fetchPagesFn.mock.calls.flatMap((call) => call[0]);
    expect(fetchedUrls).toEqual(["https://example.com/verification"]);
    expect(fetchedUrls.every((url) => !url.startsWith("attachment:"))).toBe(true);
    expect(result.hasSourcesFrame).toBe(true);
    expect(result.sourcesCount).toBe(1);
    expect(result.raw).not.toContain("attachment:");
  });

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
    const executeSearch = vi.fn(async () => hits);
    const runReconFn = vi.fn(async (_input: { query: string }) => ({ brief: "", hits: [] }));

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
          executeSearch,
          runReconFn,
        }),
        resolvedUserQuery: "数学家 王虹 最近几天 新闻",
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
    expect(runReconFn.mock.calls[0]?.[0]?.query).toBe("数学家 王虹 最近几天 新闻");
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

  it("hard-stops when the injected active clock exhausts the total budget", async () => {
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
    expect(events.some((e) => e.type === "phase" && e.phase === "synthesize")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "phase", phase: "done", message: "已达到时间预算" }),
    );
    expect(events.some((e) => e.type === "artifact" && String(e.path).endsWith("final-report.md"))).toBe(false);
    expect(text).toContain("时间上限");
    expect(text).not.toContain("budget-report");
    expect(raw).toContain("[DONE]");
  });

  it("hard-aborts a hung section when the active-time deadline expires", async () => {
    const runStore = createMemoryRunStore();
    const runId = "run-hard-deadline-01";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "超时测试",
                    sections: [
                      {
                        id: "s1",
                        title: "核心结论",
                        brief: "总结",
                        citation_indexes: [1],
                        format: "prose",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        } as Response;
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            // Never produce a section chunk; the shared deadline must cancel this read.
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "超时测试" }] },
      {
        ...baseDeps({
          runId,
          runStore,
          totalBudgetMs: 80,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          buildPlan: async () => ({
            topic: "超时测试",
            complexity: "simple" as const,
            subQuestions: ["指标"],
          }),
          executeSearch: async () => [
            { title: "来源", url: "https://example.com/source", snippet: "证据" },
          ],
        }),
      },
    );

    const { text, events, raw } = await readSsePayload(response);
    const row = await runStore.get("t1", "u1", runId);
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toContain("时间上限");
    expect(text).toContain("时间上限");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "phase", phase: "done", message: "已达到时间预算" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "phase", phase: "done", message: "已取消" }),
    );
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
    const runStore = createMemoryRunStore();
    const plan: ResearchPlan = { topic: "T", complexity: "moderate", subQuestions: ["q1", "q2"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: "<think>internal memo reasoning</think>memo body",
                },
              },
            ],
          }),
        } as Response;
      }
      return synthUpstream("<think>internal section reasoning</think>final</think>");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          artifactStore: store,
          runStore,
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
    expect(
      events.some(
        (event) =>
          event.type === "reasoning" &&
          event.kind === "reasoning" &&
          String(event.text).includes("internal section reasoning"),
      ),
    ).toBe(true);

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
    expect(memos.every((a) => a.content.includes("memo body"))).toBe(true);
    expect(memos.every((a) => !a.content.includes("internal memo reasoning"))).toBe(true);
    const markdownReport = reports.find((a) => a.path.endsWith("final-report.md"));
    expect(markdownReport?.content).toContain("final");
    expect(markdownReport?.content).not.toContain("internal section reasoning");
    expect(markdownReport?.content).not.toContain("</think>");

    const run = await runStore.get("t1", "u1", "run-art-1");
    expect(run?.reportMarkdown).not.toContain("final");
    expect(run?.reportMarkdown).not.toContain("internal");
    expect(JSON.stringify(run?.events ?? [])).toContain("internal section reasoning");
  });

  it("honors clarify html format: report.html is written and summary links to it", async () => {
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

    const responsePromise = runDeepResearchTurn(
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

    await new Promise((r) => setTimeout(r, 30));
    expect(
      resolveClarifyResume("run-html-prefs", {
        answers: {
          q_delivery_shape: "结构化报告——完整论证链",
          q_delivery_format: "可视化网页（.html）",
        },
        skip: false,
      }),
    ).toBe(true);

    const response = await responsePromise;
    const { text, events } = await readSsePayload(response);
    const htmlEvent = events.find(
      (e) => e.type === "artifact" && String(e.path).endsWith("report.html"),
    );
    expect(htmlEvent).toBeTruthy();
    // Summary must surface the HTML primary even if the model forgot the link.
    expect(text).toContain(`artifact:${String(htmlEvent!.id)}`);

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
    expect(pack).toContain("[1] 背景");
    expect(pack).toContain("[2] B");
  });

  it("skips the card after a trusted no-clarification decision without shrinking research breadth", async () => {
    const clarifyDeps: Array<Record<string, unknown>> = [];
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("fanout-report") as unknown as typeof fetch,
          intentConfidence: { routeConfidence: 0.95, queryConfidence: 0.96 },
          proposeClarify: async (deps: Record<string, unknown>) => {
            clarifyDeps.push(deps);
            return { needed: false as const };
          },
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
    expect(clarifyDeps[0]?.respectModelNoClarification).toBe(true);
    expect(events.some((e) => e.type === "clarify")).toBe(false);
    const researchLanes = events.filter(
      (e) => e.type === "lane_started" && e.laneId !== "recon-cold-start",
    );
    expect(researchLanes.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the card when either upstream confidence is below the stricter threshold", async () => {
    const clarifyDeps: Array<Record<string, unknown>> = [];
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("low-confidence-report") as unknown as typeof fetch,
          intentConfidence: { routeConfidence: 0.89, queryConfidence: 0.99 },
          proposeClarify: async (deps: Record<string, unknown>) => {
            clarifyDeps.push(deps);
            return { needed: false as const };
          },
          buildPlan: async () => ({
            topic: "deepseek v4 核心技术点",
            complexity: "simple" as const,
            subQuestions: ["deepseek v4 核心技术点"],
          }),
          executeSearch: async () => [
            { title: "t", url: "https://ex.com/low-confidence", snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    expect(clarifyDeps[0]?.respectModelNoClarification).toBe(false);
    expect(events.some((e) => e.type === "clarify")).toBe(true);
  });

  it("keeps the card when the clarifier requests input despite high confidence", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("clarify-report") as unknown as typeof fetch,
          intentConfidence: { routeConfidence: 0.99, queryConfidence: 0.99 },
          proposeClarify: async () => ({
            needed: true as const,
            questions: [
              {
                id: "focus",
                question: "优先研究哪个方向？",
                options: [
                  { id: "architecture", label: "架构" },
                  { id: "deployment", label: "部署" },
                ],
                allowCustom: true,
              },
            ],
          }),
          buildPlan: async () => ({
            topic: "deepseek v4 核心技术点",
            complexity: "simple" as const,
            subQuestions: ["deepseek v4 核心技术点"],
          }),
          executeSearch: async () => [
            { title: "t", url: "https://ex.com/clarify", snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "clarify" && e.questionId === "focus")).toBe(true);
  });

  it("keeps the card when the clarifier fails despite high confidence", async () => {
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "deepseek v4 核心技术点" }] },
      {
        ...baseDeps({
          fetchImpl: gatewayStub("clarifier-failure-report") as unknown as typeof fetch,
          intentConfidence: { routeConfidence: 0.99, queryConfidence: 0.99 },
          proposeClarify: async () => {
            throw new Error("clarifier unavailable");
          },
          buildPlan: async () => ({
            topic: "deepseek v4 核心技术点",
            complexity: "simple" as const,
            subQuestions: ["deepseek v4 核心技术点"],
          }),
          executeSearch: async () => [
            { title: "t", url: "https://ex.com/fallback", snippet: "s" },
          ],
        }),
      },
    );

    const { events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "clarify")).toBe(true);
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
            subQuestions: ["q1", "q2"],
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

describe("lane adopt cap", () => {
  it("caps a single lane but lets it use the whole remaining budget", () => {
    expect(resolveLaneAdoptCap(0)).toBe(LANE_ADOPT_CAP);
    expect(resolveLaneAdoptCap(MAX_SOURCES - 3)).toBe(3);
    expect(resolveLaneAdoptCap(MAX_SOURCES)).toBe(0);
    expect(resolveLaneAdoptCap(MAX_SOURCES + 5)).toBe(0);
  });

  it("is decoupled from the per-query request count so adoption is not capped at it", () => {
    // 5 lanes request 8 results per query; adoption must not inherit that 8.
    expect(resolveLaneAdoptCap(0)).toBeGreaterThan(resolveResultsPerLane(5));
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

  it("runs one lane per planned sub-question up to MAX_LANES", async () => {
    const subQuestions = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];
    const requestedResults: number[] = [];
    const expectedLaneCount = Math.min(subQuestions.length, MAX_LANES);

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
    expect(researchLanes).toHaveLength(expectedLaneCount);
    expect(expectedLaneCount).toBe(MAX_LANES);
    expect(new Set(requestedResults)).toEqual(new Set([resolveResultsPerLane(expectedLaneCount)]));
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
    expect(pack).toContain("搜索摘要：sa");
    expect(pack).toContain('source="public_web"');
    expect(pack).toContain("不可信证据数据");
    expect(pack).toContain("证据覆盖提醒：当前仅 1 个来源域名");
    expect(formatSourcesAppendix(citations)).toContain("**来源**");
  });

  it("labels uploaded document evidence without exposing its synthetic URL", () => {
    const citations: Citation[] = [
      {
        index: 1,
        title: "Paper",
        url: "attachment:paper.pdf%3Aabc",
        snippet: "parsed excerpt",
        sourceType: "attachment",
        sourceLabel: "paper.pdf",
      },
    ];
    const pack = formatEvidencePack(
      { topic: "Paper", complexity: "moderate", subQuestions: ["方法"] },
      [{ question: "方法", citations }],
    );

    expect(pack).toContain("来源：用户上传文件（paper.pdf）");
    expect(pack).not.toContain("attachment:");
    expect(formatSourcesAppendix(citations)).toContain("用户上传文件（paper.pdf）");
    expect(formatSourcesAppendix(citations)).not.toContain("attachment:");
  });

  it("keeps provider dates without declaring a trend from metadata", () => {
    const citations: Citation[] = [
      { index: 1, title: "A", url: "https://a.com", snippet: "sa", publishedAt: "2026-08-01" },
      { index: 2, title: "B", url: "https://b.com", snippet: "sb", publishedAt: "2026-08-10" },
    ];
    const pack = formatEvidencePack(
      { topic: "主题", complexity: "moderate", subQuestions: ["子问"] },
      [{ question: "子问", citations }],
    );
    expect(pack).not.toContain("证据覆盖提醒");
    expect(pack).not.toContain("达到趋势陈述最低门槛");
    expect(pack).toContain("发布时间: 2026-08-10");
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
    expect(pack).toContain("正文相关片段：这是抓取到的全文内容");
    expect(pack).not.toContain("搜索摘要：sa");
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
          executeSearch: async (
            query: ExecuteSearchArgs[0],
            _max: ExecuteSearchArgs[1],
            _cfg: ExecuteSearchArgs[2],
            _fetch: ExecuteSearchArgs[3],
            diagnostics: ExecuteSearchArgs[4],
          ) => {
            calls.push(query);
            diagnostics?.onProviderAttempt?.({
              providerId: "customer-primary",
              outcome: "ok",
              hitCount: 1,
              durationMs: 1,
            });
            return [{ title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" }];
          },
        }),
      },
    );
    const { events } = await readSsePayload(response);
    expect(calls).toHaveLength(6);
    const sourceEvents = events.filter((event) => event.type === "lane_sources");
    expect(sourceEvents).toHaveLength(2);
    const trace = sourceEvents[0]?.trace as {
      topLevelQueriesRun?: number;
      providerCalls?: number;
      queries?: Array<{ status?: string; hitCount?: number; providerIds?: string[] }>;
    };
    expect(trace.topLevelQueriesRun).toBe(3);
    expect(trace.providerCalls).toBe(3);
    expect(trace.queries).toEqual([
      expect.objectContaining({ status: "ok", hitCount: 1, providerIds: ["customer-primary"] }),
      expect.objectContaining({ status: "ok", hitCount: 1, providerIds: ["customer-primary"] }),
      expect.objectContaining({ status: "ok", hitCount: 1, providerIds: ["customer-primary"] }),
    ]);
  });

  it("skips remaining queries once a lane has more candidates than it can adopt", async () => {
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
            { query: `${subQuestion} 质疑`, kind: "contrarian" as const },
          ],
          executeSearch: async (query: string) => {
            calls.push(query);
            // One full provider page is enough even though it is smaller than
            // the lane-wide adopt cap.
            return Array.from({ length: MAX_RESULTS_PER_LANE }, (_, i) => ({
              title: `${query}-${i}`,
              url: `https://ex.com/${encodeURIComponent(query)}/${i}`,
              snippet: "s",
            }));
          },
        }),
      },
    );

    const { events } = await readSsePayload(response);
    const laneCalls = calls.filter((q) => q.startsWith("q1"));
    expect(laneCalls).toHaveLength(EARLY_STOP_PROBE_VARIANTS);
    expect(laneCalls.some((q) => q.includes("english"))).toBe(false);

    const earlyStop = events.find(
      (e) => e.type === "lane_progress" && String(e.message ?? "").includes("省去"),
    );
    expect(String(earlyStop?.message ?? "")).toContain(`实际检索 ${EARLY_STOP_PROBE_VARIANTS} 条`);

    const stats = events.find((e) => e.type === "research_stats");
    // Reported spend must be what actually ran (2 lanes × one-query probe), not the 4
    // queries each lane expanded.
    expect(stats?.queriesPlanned).toBe(EARLY_STOP_PROBE_VARIANTS * 2);
    const laneSources = events.find(
      (event) => event.type === "lane_sources" && String(event.laneId).includes("q1"),
    );
    const trace = laneSources?.trace as {
      topLevelQueriesRun?: number;
      queries?: Array<{ status?: string }>;
    };
    expect(trace.topLevelQueriesRun).toBe(EARLY_STOP_PROBE_VARIANTS);
    const skipped = trace.queries?.slice(EARLY_STOP_PROBE_VARIANTS) ?? [];
    expect(skipped).toHaveLength(4 - EARLY_STOP_PROBE_VARIANTS);
    expect(skipped.every((query) => query.status === "skipped")).toBe(true);
  });

  it("runs every query when candidates stay below the adopt budget", async () => {
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
            return [
              { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
            ];
          },
        }),
      },
    );

    await readSsePayload(response);
    expect(calls.filter((q) => q.startsWith("q1"))).toHaveLength(3);
  });

  it("deduplicates repeated gap queries while exposing bounded refinement progress", async () => {
    let reflectCalls = 0;
    const searchCalls: string[] = [];
    const artifactStore = createMemoryArtifactStore();
    const runId = "internal-refinement-run";
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "主题调研" }] },
      {
        ...baseDeps({
          artifactStore,
          runId,
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
          executeSearch: async (query: string) => {
            searchCalls.push(query);
            return [
              { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
            ];
          },
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
    const { events, sourcesCount } = await readSsePayload(response);
    expect(reflectCalls).toBe(2);
    expect(searchCalls.filter((query) => query === "official paper")).toHaveLength(1);
    const stats = events.find((event) => event.type === "research_stats");
    expect(stats?.queriesPlanned).toBe(3);
    expect(stats?.sourcesSelected).toBe(3);
    expect(sourcesCount).toBe(3);
    const reflectPhases = events.filter(
      (event) => event.type === "phase" && event.phase === "reflect",
    );
    expect(reflectPhases).toEqual([
      expect.objectContaining({ message: "正在复核并补充关键证据…" }),
    ]);
    expect(events.some((event) => event.type === "reflection")).toBe(false);
    expect(
      events.some(
        (event) =>
          typeof event.laneId === "string" && event.laneId.startsWith("gap-"),
      ),
    ).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "phase",
        phase: "lanes",
        message: "正在补充验证第 1 轮 · 1 项关键证据…",
      }),
    );
    expect(JSON.stringify(events)).toContain("缺官方论文");
    expect(JSON.stringify(events)).toContain("official paper");

    const artifacts = await artifactStore.listByRun("t1", "u1", runId);
    expect(artifacts.some((artifact) => artifact.path.includes("/lanes/gap-"))).toBe(false);
  });

  it("feeds each follow-up memo into the next longitudinal reflection", async () => {
    let reflectCalls = 0;
    const memoSnapshots: string[][] = [];
    const searchCalls: string[] = [];
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
          executeSearch: async (query: string) => {
            searchCalls.push(query);
            return [
              { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
            ];
          },
          reflectFn: async ({ laneMemos }: { laneMemos: Array<{ question: string }> }) => {
            reflectCalls += 1;
            memoSnapshots.push(laneMemos.map((row) => row.question));
            if (reflectCalls === 1) {
              return [{ id: "g1", description: "第一缺口", queries: ["first evidence"] }];
            }
            if (reflectCalls === 2) {
              return [{ id: "g2", description: "第二缺口", queries: ["second evidence"] }];
            }
            return [];
          },
        }),
      },
    );

    await readSsePayload(response);
    expect(reflectCalls).toBe(3);
    expect(memoSnapshots.map((snapshot) => snapshot.length)).toEqual([2, 3, 4]);
    expect(memoSnapshots[1]).toContain("第一缺口");
    expect(memoSnapshots[2]).toEqual(expect.arrayContaining(["第一缺口", "第二缺口"]));
    expect(searchCalls).toEqual(expect.arrayContaining(["first evidence", "second evidence"]));
  });

  it("stops longitudinal refinement when a follow-up adds no new evidence URL", async () => {
    let reflectCalls = 0;
    const searchCalls: string[] = [];
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
          executeSearch: async (query: string) => {
            searchCalls.push(query);
            return [{ title: query, url: "https://ex.com/shared#fragment", snippet: "s" }];
          },
          reflectFn: async () => {
            reflectCalls += 1;
            return [
              {
                id: `g${reflectCalls}`,
                description: "重复来源缺口",
                queries: [`duplicate evidence ${reflectCalls}`],
              },
            ];
          },
        }),
      },
    );

    await readSsePayload(response);
    expect(reflectCalls).toBe(1);
    expect(searchCalls.filter((query) => query.startsWith("duplicate evidence"))).toEqual([
      "duplicate evidence 1",
    ]);
  });

  it.each([
    { firstFacetHits: MAX_RESULTS_PER_LANE, expectedFacets: ["facet-1"] },
    { firstFacetHits: 1, expectedFacets: ["facet-1", "facet-2"] },
  ])(
    "runs crowded gap facets sequentially and stops after enough evidence ($firstFacetHits first hits)",
    async ({ firstFacetHits, expectedFacets }) => {
      let reflectCalls = 0;
      const gapCalls: string[] = [];
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
            executeSearch: async (query: string) => {
              if (!query.startsWith("facet-")) {
                return [
                  { title: query, url: `https://initial.test/${query}`, snippet: "s" },
                ];
              }
              gapCalls.push(query);
              const hitCount = query === "facet-1" ? firstFacetHits : MAX_RESULTS_PER_LANE;
              return Array.from({ length: hitCount }, (_, index) => ({
                title: `${query}-${index}`,
                url: `https://gap.test/${query}/${index}`,
                snippet: "s",
              }));
            },
            reflectFn: async () => {
              reflectCalls += 1;
              return reflectCalls === 1
                ? [
                    {
                      id: "g1",
                      description: "拥挤缺口",
                      queries: ["facet-1", "facet-2", "facet-3"],
                    },
                  ]
                : [];
            },
          }),
        },
      );

      await readSsePayload(response);
      expect(gapCalls).toEqual(expectedFacets);
      expect(gapCalls).not.toContain("facet-3");
    },
  );

  it("enforces the total six-query follow-up budget across rounds", async () => {
    let reflectCalls = 0;
    const gapCalls: string[] = [];
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
          executeSearch: async (query: string) => {
            if (query.startsWith("round-")) gapCalls.push(query);
            return [
              { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
            ];
          },
          reflectFn: async () => {
            reflectCalls += 1;
            return [
              {
                id: `g${reflectCalls}`,
                description: `第 ${reflectCalls} 轮缺口`,
                queries: [1, 2, 3].map((index) => `round-${reflectCalls}-facet-${index}`),
              },
            ];
          },
        }),
      },
    );

    const { events } = await readSsePayload(response);
    expect(reflectCalls).toBe(2);
    expect(gapCalls).toHaveLength(MAX_FOLLOWUP_QUERIES);
    const stats = events.find((event) => event.type === "research_stats");
    expect(stats?.queriesPlanned).toBe(2 + MAX_FOLLOWUP_QUERIES);
  });

  it("stops after the bounded number of reflection rounds", async () => {
    let reflectCalls = 0;
    const gapCalls: string[] = [];
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
          executeSearch: async (query: string) => {
            if (query.startsWith("bounded-")) gapCalls.push(query);
            return [
              { title: query, url: `https://ex.com/${encodeURIComponent(query)}`, snippet: "s" },
            ];
          },
          reflectFn: async () => {
            reflectCalls += 1;
            return [
              {
                id: `g${reflectCalls}`,
                description: `持续缺口 ${reflectCalls}`,
                queries: [`bounded-${reflectCalls}`],
              },
            ];
          },
        }),
      },
    );

    await readSsePayload(response);
    expect(reflectCalls).toBe(MAX_REFLECT_ROUNDS);
    expect(gapCalls).toHaveLength(MAX_REFLECT_ROUNDS);
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
    expect(report!.content).toContain("核心结论");
    expect(report!.content).toContain("分项分析");
    expect(report!.content).not.toContain("不确定性与信息缺口");
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
