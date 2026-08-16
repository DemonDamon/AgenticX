/**
 * With the tenant calculation switch off, every path must send upstream exactly
 * what it sent before the calculator existed.
 *
 * The expectations in `rollback-baseline.json` are not hand-written. They were
 * recorded by running these same six scenarios against the pre-calculator tree
 * at 645e1d09, plus a cherry-pick of the main-text extraction fix 953c0438,
 * which stays outside the switch on purpose. Hand-written
 * expectations would only prove that the off path matches what someone thought
 * the old path did.
 *
 * Timestamps are the one thing normalised away; nothing else may differ.
 */
import { describe, expect, it } from "vitest";
import baseline from "./rollback-baseline.json";
import { runWebSearchTurn } from "../tool-loop";
import type { WebSearchHit } from "../providers";
import type { DirectPageView } from "../direct-page";

function sse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const HITS: WebSearchHit[] = [
  {
    title: "某公司半年报",
    url: "https://ex.com/hy",
    snippet: "上半年营业收入 907.03 亿元，净利润 445.17 亿元。",
  },
  { title: "上年同期", url: "https://ex.com/last", snippet: "上年同期营业收入 893.90 亿元。" },
];

const tenant = (calculatorEnabled: boolean, enabled = true) => ({
  enabled,
  provider: "duckduckgo" as const,
  apiKey: "",
  maxResults: 5,
  calculatorEnabled,
});

const PAGE = async (reference: unknown): Promise<DirectPageView> =>
  ({
    reference,
    title: "某公司半年报",
    text: "某公司半年报\n\n上半年实现营业收入 907.03 亿元。\n\n归属于母公司股东的净利润 445.17 亿元。",
    rawChars: 120,
    coverage: "full_html",
    backend: "native",
  }) as DirectPageView;

const NO_SEARCH_REWRITE = JSON.stringify({
  need_search: false,
  resolved_query: "去年毛利率 28.5，今年 31.2，高了多少",
  search_queries: [],
  confidence: 0.95,
  calculation_intent: "needed",
});

function normalize(body: Record<string, unknown>): unknown {
  const { messages, ...rest } = body;
  return {
    ...rest,
    messages: (messages as Array<{ role?: string; content?: unknown }> | undefined)?.map(
      (message) => ({
        role: message.role,
        content: String(message.content ?? "").replace(/\d{4}-\d{2}-\d{2}[^\n]*/g, "<TIME>"),
      }),
    ),
  };
}

type Scenario = keyof typeof baseline;

async function capture(
  calculatorEnabled: boolean,
  scenario: Scenario,
): Promise<{ calls: number; bodies: unknown[] }> {
  const bodies: Array<Record<string, unknown>> = [];
  const gateway = (rewrite?: string) =>
    (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      bodies.push(body as Record<string, unknown>);
      if (rewrite && body.stream === false) {
        return json({ choices: [{ message: { content: rewrite } }] });
      }
      // A calculation planner reply, so an enabled run really does inject.
      if (body.stream === false) {
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  calculations: [
                    { id: "c1", operation: "sum", operands: ["907.03", "445.17"] },
                  ],
                }),
              },
            },
          ],
        });
      }
      return sse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    }) as unknown as typeof fetch;

  const base = {
    url: "http://gateway.test/v1/chat/completions",
    headers: {},
    executeSearch: async () => (scenario === "search" ? HITS : []),
  };

  const turns: Record<Scenario, () => Promise<Response>> = {
    search: () =>
      runWebSearchTurn(
        {
          model: "m",
          messages: [{ role: "user", content: "这家公司上半年净利率和营收同比是多少" }],
          agenticx_web_search: true,
        },
        { ...base, fetchImpl: gateway(), loadTenantConfig: async () => tenant(calculatorEnabled) },
      ),
    directUrl: () =>
      runWebSearchTurn(
        {
          model: "m",
          messages: [
            { role: "user", content: "https://ex.com/hy 打开这个财报页，帮我算一下净利率" },
          ],
          agenticx_web_search: true,
        },
        {
          ...base,
          fetchImpl: gateway(),
          loadTenantConfig: async () => tenant(calculatorEnabled),
          readPage: PAGE as never,
        },
      ),
    arithmeticFastSkip: () =>
      runWebSearchTurn(
        { model: "m", messages: [{ role: "user", content: "0.1+0.2" }], agenticx_web_search: true },
        { ...base, fetchImpl: gateway(), loadTenantConfig: async () => tenant(calculatorEnabled) },
      ),
    semanticNoSearch: () =>
      runWebSearchTurn(
        {
          model: "m",
          messages: [
            { role: "user", content: "上次那家公司的毛利率是多少" },
            { role: "assistant", content: "去年 28.5%。" },
            { role: "user", content: "去年毛利率 28.5，今年 31.2，高了多少" },
          ],
          agenticx_web_search: true,
        },
        {
          ...base,
          fetchImpl: gateway(NO_SEARCH_REWRITE),
          loadTenantConfig: async () => tenant(calculatorEnabled),
        },
      ),
    adminDisabled: () =>
      runWebSearchTurn(
        { model: "m", messages: [{ role: "user", content: "31.2 - 28.5" }], agenticx_web_search: true },
        {
          ...base,
          fetchImpl: gateway(),
          loadTenantConfig: async () => tenant(calculatorEnabled, false),
        },
      ),
    retrievalFailed: () =>
      runWebSearchTurn(
        {
          model: "m",
          messages: [{ role: "user", content: "查一下今年行情。另外 31.2 - 28.5 是多少" }],
          agenticx_web_search: true,
        },
        { ...base, fetchImpl: gateway(), loadTenantConfig: async () => tenant(calculatorEnabled) },
      ),
  };

  await (await turns[scenario]()).text();
  return { calls: bodies.length, bodies: bodies.map(normalize) };
}

const SCENARIOS = Object.keys(baseline) as Scenario[];

describe("tenant calculation rollback", () => {
  it.each(SCENARIOS)(
    "sends the pre-calculator request when the switch is off: %s",
    async (scenario) => {
      expect(await capture(false, scenario)).toEqual(baseline[scenario]);
    },
  );

  it.each(SCENARIOS)("spends no planning call when the switch is off: %s", async (scenario) => {
    const off = await capture(false, scenario);
    expect(off.calls).toBe(baseline[scenario].calls);
  });

  it("is a real switch, not a no-op: the same scenarios do change when it is on", async () => {
    // If nothing above this line could ever differ, the contract tests prove
    // nothing. At least one scenario must visibly compute when enabled.
    const changed = await Promise.all(
      SCENARIOS.map(async (scenario) => {
        const on = await capture(true, scenario);
        return JSON.stringify(on) !== JSON.stringify(baseline[scenario]);
      }),
    );
    expect(changed.filter(Boolean).length).toBeGreaterThan(0);
    expect(JSON.stringify(await capture(true, "search"))).toContain("本轮确定性计算结果");
  });

  it("reads a tenant row without the column as off", async () => {
    // A database that predates the migration must restore the old path rather
    // than assume a feature the operator never enabled.
    const legacy = await capture(false, "search");
    const bodies: Array<Record<string, unknown>> = [];
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "这家公司上半年净利率和营收同比是多少" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return sse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
        }) as unknown as typeof fetch,
        // No `calculatorEnabled` key at all — what a legacy-column read returns.
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
        }),
        executeSearch: async () => HITS,
      },
    );
    await res.text();
    expect(bodies).toHaveLength(legacy.calls);
  });
});
