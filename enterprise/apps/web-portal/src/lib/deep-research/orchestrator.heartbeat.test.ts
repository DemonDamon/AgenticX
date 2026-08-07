import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDeepResearchTurn } from "./orchestrator";
import { createMemoryArtifactStore } from "./artifact-store";
import { createMemoryRunStore } from "./run-store";
import { emptyFetchStats } from "../web-search/page-fetch";
import type { ResearchPlan } from "./planner";

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

describe("deep-research SSE heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits timed : ping frames during a long lane hang and clears the timer", async () => {
    let releaseHang: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const plan: ResearchPlan = {
      topic: "主题",
      complexity: "moderate",
      subQuestions: ["子问1"],
    };

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "车道备忘摘要" } }],
          }),
        } as Response;
      }
      return synthUpstream("核心结论正文");
    });

    const response = await runDeepResearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "调研一下某某" }],
        stream: true,
        agenticx_deep_research: true,
      },
      {
        url: "http://gw/v1/chat/completions",
        headers: {},
        awaitClarify: false,
        artifactStore: createMemoryArtifactStore(),
        runStore: createMemoryRunStore(),
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
        probeEgressFn: async () => true,
        runReconFn: async () => {
          await hang;
          return { brief: "", hits: [] };
        },
        fetchPagesFn: async (urls: string[]) => ({
          pages: urls.map(() => null),
          stats: emptyFetchStats(),
        }),
        expandQueriesFn: async ({ subQuestion }: { subQuestion: string }) => [
          { query: subQuestion, kind: "primary" as const },
        ],
        reflectFn: async () => [],
        buildPlan: async () => plan,
        executeSearch: async () => [],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    const consume = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
    })();

    // Let the stream start and enter the recon hang.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);

    const pingsDuringHang = (raw.match(/: ping/g) ?? []).length;
    expect(pingsDuringHang).toBeGreaterThanOrEqual(3);

    releaseHang!();
    await vi.runAllTimersAsync();
    await consume;

    // Heartbeat interval must be cleared after the stream finishes.
    expect(vi.getTimerCount()).toBe(0);
  });
});
