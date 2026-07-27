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
import type { ResearchPlan } from "./planner";
import type { Citation } from "./registry";

async function readSseText(response: Response): Promise<string> {
  const text = await response.text();
  const deltas: string[] = [];
  for (const block of text.split("\n\n")) {
    const line = block
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!line) continue;
    const data = line.replace(/^data:\s*/, "");
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string") deltas.push(content);
    } catch {
      // ignore non-json
    }
  }
  return deltas.join("");
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
  it("includes all sub-questions and citation indexes in synth user message; appends sources", async () => {
    const plan: ResearchPlan = {
      topic: "主题",
      subQuestions: ["子问1", "子问2"],
    };
    let synthBody: Record<string, unknown> | null = null;
    let fetchCount = 0;

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      fetchCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role: string; content?: string }>;
      };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ topic: plan.topic, sub_questions: plan.subQuestions }) } }],
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
        url: "http://gw/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        executeSearch: async () => hits,
        buildPlan: async () => plan,
      },
    );

    const text = await readSseText(response);
    expect(text).toContain("正在规划研究路径");
    expect(text).toContain("核心结论正文");
    expect(text).toContain("**来源**");
    expect(text).toContain("https://ex.com/1");
    expect(text).toContain("https://ex.com/3");
    expect(fetchCount).toBeGreaterThanOrEqual(1);
    expect(synthBody).not.toBeNull();

    const messages =
      (synthBody as unknown as { messages?: Array<{ role: string; content?: string }> } | null)?.messages ??
      [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("子问1");
    expect(lastUser?.content).toContain("子问2");
    expect(lastUser?.content).toContain("[1]");
    expect(lastUser?.content).toMatch(/\[3\]/);
  });

  it("clamps total sources to MAX_SOURCES", async () => {
    const plan: ResearchPlan = {
      topic: "T",
      subQuestions: ["q1", "q2", "q3", "q4", "q5"],
    };
    let appendixUrls = 0;

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ topic: "T", sub_questions: plan.subQuestions }) } }],
          }),
        } as Response;
      }
      return synthUpstream("ok");
    });

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "q" }],
      },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async (query) =>
          Array.from({ length: 10 }, (_, i) => ({
            title: `${query}-${i}`,
            url: `https://ex.com/${query}/${i}`,
            snippet: "s",
          })),
      },
    );

    const text = await readSseText(response);
    const matches = text.match(/https:\/\/ex\.com\//g) ?? [];
    appendixUrls = matches.length;
    expect(appendixUrls).toBeLessThanOrEqual(MAX_SOURCES);
  });

  it("continues when one sub-question fails", async () => {
    const plan: ResearchPlan = { topic: "T", subQuestions: ["bad", "good"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ topic: "T", sub_questions: plan.subQuestions }) } }],
          }),
        } as Response;
      }
      return synthUpstream("report");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async (query) => {
          if (query === "bad") throw new Error("boom");
          return [{ title: "Ok", url: "https://ok.com", snippet: "s" }];
        },
      },
    );

    const text = await readSseText(response);
    expect(text).toContain("report");
    expect(text).toContain("https://ok.com");
    expect(text).not.toContain(DEEP_RESEARCH_SEARCH_FAILED);
  });

  it("emits failure copy when all searches fail", async () => {
    const plan: ResearchPlan = { topic: "T", subQuestions: ["a", "b"] };
    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: vi.fn() as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async () => {
          throw new Error("down");
        },
      },
    );
    const text = await readSseText(response);
    expect(text).toContain(DEEP_RESEARCH_SEARCH_FAILED);
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
        url: "http://gw",
        headers: {},
        signal: controller.signal,
        fetchImpl: vi.fn(async () => synthUpstream("partial")) as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async () => {
          searchStarts += 1;
          await new Promise((r) => setTimeout(r, 40));
          return [{ title: "t", url: `https://ex.com/${searchStarts}`, snippet: "s" }];
        },
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
      if (body.stream === false) return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) } as Response;
      return synthUpstream("budget-report");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => {
          const v = clock;
          clock += 200_000;
          return v;
        },
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async () => [{ title: "t", url: "https://ex.com/1", snippet: "s" }],
      },
    );

    const text = await readSseText(response);
    expect(text).toContain("正在综合分析");
    expect(text).toContain("budget-report");
  });

  it("progress frames are incremental and ordered", async () => {
    const plan: ResearchPlan = { topic: "T", subQuestions: ["q1"] };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ topic: "T", sub_questions: ["q1"] }) } }],
          }),
        } as Response;
      }
      return synthUpstream("final");
    });

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }] },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
        buildPlan: async () => plan,
        executeSearch: async () => [{ title: "t", url: "https://ex.com/1", snippet: "s" }],
      },
    );

    const text = await readSseText(response);
    const i1 = text.indexOf("1/3");
    const i2 = text.indexOf("2/3");
    const i3 = text.indexOf("3/3");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
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
