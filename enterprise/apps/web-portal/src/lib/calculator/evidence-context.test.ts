import { describe, expect, it, vi } from "vitest";
import { planEvidenceCalculations } from "./evidence-context";

function gatewayJson(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const planner = (calculations: unknown) =>
  vi.fn(async () => gatewayJson(JSON.stringify({ calculations })));

/** What the two sources actually said. */
const SOURCES = [
  "公司半年报摘要\n上半年实现营业收入 907.03 亿元，归属于上市公司股东的净利润 445.17 亿元。",
  "去年同期数据\n上年同期营业收入 893.90 亿元。",
];

/** The same evidence formatted the way the answering model receives it. */
const EVIDENCE = `[1] 公司半年报摘要
URL: https://example.com/a
上半年实现营业收入 907.03 亿元，归属于上市公司股东的净利润 445.17 亿元。

[2] 去年同期数据
URL: https://example.com/b
上年同期营业收入 893.90 亿元。`;

const run = async (calculations: unknown, anchorTexts: readonly string[] = SOURCES) => {
  const fetchImpl = planner(calculations);
  const results = await planEvidenceCalculations({
    deps: { url: "https://gw.example/v1/chat/completions", headers: {}, fetchImpl },
    body: { model: "m" },
    task: "用户当前请求：这家公司上半年的净利率和营收同比是多少",
    evidenceText: EVIDENCE,
    anchorTexts,
  });
  return { results, fetchImpl };
};

describe("evidence calculations", () => {
  it("computes a derived ratio the model composed from primitives", async () => {
    // 净利率 is not a concept this module knows; the model expressed it as a
    // quotient of two figures that are on the page.
    const { results } = await run([
      { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.operation).toBe("quotient");
    expect(results[0]?.displayValue?.startsWith("0.49079")).toBe(true);
  });

  it("computes year-over-year change from two periods in the evidence", async () => {
    const { results } = await run([
      { id: "c1", operation: "percentage_change", operands: ["893.90", "907.03"] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.value?.startsWith("1.46884")).toBe(true);
  });

  it("runs one non-streaming call that cannot fan out into tools", async () => {
    const { fetchImpl } = await run([
      { id: "c1", operation: "sum", operands: ["907.03", "445.17"] },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.tools).toBeUndefined();
    expect(init.headers).toMatchObject({
      "x-agenticx-trace-stage": "chat.search-calculator",
    });
  });

  it("drops an operand that appears nowhere in the evidence", async () => {
    // The number the model has to get right is the one it reads off the page.
    // 445.17 misread as 445.71 is exact arithmetic on the wrong figure.
    const { results } = await run([
      { id: "c1", operation: "quotient", operands: ["445.71", "907.03"] },
    ]);
    expect(results).toEqual([]);
  });

  it("keeps the anchored calculations and drops only the unanchored ones", async () => {
    const { results } = await run([
      { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
      { id: "c2", operation: "sum", operands: ["907.03", "9999.99"] },
    ]);
    expect(results.map((result) => result.id)).toEqual(["c1"]);
  });

  it("anchors a number the user supplied but the evidence does not carry", async () => {
    const { results } = await run(
      [{ id: "c1", operation: "product", operands: ["907.03", "1.06"] }],
      [...SOURCES, "按 1.06 的汇率折算一下"],
    );
    expect(results).toHaveLength(1);
  });

  it("does not let a citation marker or a URL become an operand", async () => {
    // The evidence block the model reads is "[1] …", "[2] …", with URLs that
    // carry digits of their own. None of that is a figure a page reported, so
    // none of it may anchor — otherwise the portal's own formatting would
    // authorise operands.
    const { results } = await run([
      { id: "c1", operation: "sum", operands: ["1", "2"] },
    ]);
    expect(results).toEqual([]);
  });

  it("never lets the model supply the value itself", async () => {
    const { results } = await run([
      {
        id: "c1",
        operation: "quotient",
        operands: ["445.17", "907.03"],
        result: "0.5",
        value: "0.5",
      },
    ]);
    expect(results[0]?.value).not.toBe("0.5");
  });

  it("anchors an operand the sources state more than once", async () => {
    // A precondition counting DISTINCT anchorable numbers used to sit in front
    // of this call, and it rejected every repeated operand: "5+5" states two
    // operands and one value. The gate saved nothing the upstream hint does not
    // already save, so it is gone.
    const { results, fetchImpl } = await run(
      [{ id: "c1", operation: "sum", operands: ["5", "5"] }],
      ["两个季度各 5 亿元。"],
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.value).toBe("10");
  });

  it("degrades to no calculations when the planner is unusable", async () => {
    for (const impl of [
      vi.fn(async () => gatewayJson("not json")),
      vi.fn(async () => new Response("nope", { status: 500 })),
      vi.fn(async () => {
        throw new Error("gateway unreachable");
      }),
    ]) {
      const results = await planEvidenceCalculations({
        deps: { url: "https://gw.example", headers: {}, fetchImpl: impl as typeof fetch },
        body: {},
        task: "用户当前请求：净利率",
        evidenceText: EVIDENCE,
        anchorTexts: SOURCES,
      });
      expect(results).toEqual([]);
    }
  });

  it("rejects an operation outside the seven primitives", async () => {
    const { results } = await run([
      { id: "c1", operation: "irr", operands: ["907.03", "445.17"] },
      { id: "c2", operation: "eval", operands: ["907.03"] },
    ]);
    expect(results).toEqual([]);
  });
});
