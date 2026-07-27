import { describe, expect, it, vi } from "vitest";
import {
  DEEP_RESEARCH_SEARCH_FAILED,
  MAX_SOURCES,
  SEARCH_CONCURRENCY,
  formatEvidencePack,
  formatSourcesAppendix,
  mapPool,
  runDeepResearchTurn,
} from "./orchestrator";
import { createMemoryArtifactStore } from "./artifact-store";
import { clearClarifyWaiters, resolveClarifyResume } from "./run-wait";
import type { ResearchPlan } from "./planner";
import type { Citation } from "./registry";

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
    expect(text).toContain("核心结论正文");
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

  it("clamps total sources to MAX_SOURCES", async () => {
    const plan: ResearchPlan = {
      topic: "T",
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
    const plan: ResearchPlan = { topic: "T", subQuestions: ["bad", "good"] };
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

    const { text, hasSourcesFrame } = await readSsePayload(response);
    expect(text).toContain("report");
    expect(hasSourcesFrame).toBe(true);
    expect(text).not.toContain(DEEP_RESEARCH_SEARCH_FAILED);
  });

  it("emits failure copy when all searches fail", async () => {
    const plan: ResearchPlan = { topic: "T", subQuestions: ["a", "b"] };
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

  it("stops issuing new fetches after abort", async () => {
    const controller = new AbortController();
    let searchStarts = 0;
    const plan: ResearchPlan = {
      topic: "T",
      subQuestions: ["q1", "q2", "q3", "q4"],
    };

    const responsePromise = runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        ...baseDeps({
          signal: controller.signal,
          fetchImpl: vi.fn(async () => synthUpstream("partial")) as unknown as typeof fetch,
          buildPlan: async () => plan,
          executeSearch: async () => {
            searchStarts += 1;
            await new Promise((r) => setTimeout(r, 40));
            return [{ title: "t", url: `https://ex.com/${searchStarts}`, snippet: "s" }];
          },
        }),
      },
    );

    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await responsePromise;
    expect(searchStarts).toBeLessThan(plan.subQuestions.length);
  });

  it("still produces a report when total budget is exhausted after planning", async () => {
    let clock = 0;
    const plan: ResearchPlan = { topic: "T", subQuestions: ["q1", "q2"] };
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

    const { text, events } = await readSsePayload(response);
    expect(events.some((e) => e.type === "phase" && e.phase === "synthesize")).toBe(true);
    expect(text).toContain("budget-report");
  });

  it("waits for clarify resume before starting lanes", async () => {
    clearClarifyWaiters();
    const plan: ResearchPlan = { topic: "T", subQuestions: ["q1"] };
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
    expect(text).toContain("after-clarify");
    clearClarifyWaiters();
  });

  it("writes one memo artifact per successful lane", async () => {
    const store = createMemoryArtifactStore();
    const plan: ResearchPlan = { topic: "T", subQuestions: ["q1", "q2"] };
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
    expect(reports.length).toBe(1);
  });
});

describe("formatEvidencePack / formatSourcesAppendix", () => {
  it("formats citations", () => {
    const citations: Citation[] = [
      { index: 1, title: "A", url: "https://a.com", snippet: "sa" },
    ];
    const pack = formatEvidencePack(
      { topic: "主题", subQuestions: ["子问"] },
      [{ question: "子问", citations }],
    );
    expect(pack).toContain("研究主题：主题");
    expect(pack).toContain("[1] A");
    expect(formatSourcesAppendix(citations)).toContain("**来源**");
  });
});
