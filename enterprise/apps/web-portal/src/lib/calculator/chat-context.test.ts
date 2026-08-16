import { describe, expect, it, vi } from "vitest";
import { shouldPlanCalculator, withCalculatorContext } from "./chat-context";

function gatewayJson(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("calculator turn routing", () => {
  const fires = (text: string) => shouldPlanCalculator([{ role: "user", content: text }]);

  it("uses structural numeric shape instead of a business keyword list", () => {
    expect(fires("你好")).toBe(false);
    expect(fires("0.1 + 0.2 等于多少？")).toBe(true);
    expect(fires("800 的 12.5% 是多少？")).toBe(true);
    expect(
      shouldPlanCalculator([
        {
          role: "user",
          content: [{ type: "text", text: "1200 到 1400 的变化率" }],
        },
      ]),
    ).toBe(true);
  });

  it("fires on an expression, an infix operator, or a named operation", () => {
    expect(fires("1+2")).toBe(true);
    expect(fires("1-2")).toBe(true);
    expect(fires("-2+3")).toBe(true);
    expect(fires("请算 10/4")).toBe(true);
    expect(fires("10/4")).toBe(true);
    expect(fires("请算 1+2")).toBe(true);
    expect(fires("0.1 加 0.2 等于多少")).toBe(true);
    expect(fires("3 乘 7 等于几")).toBe(true);
    expect(fires("1200 - 300 是多少")).toBe(true);
    expect(fires("帮我算下 1234.5 和 6789 的平均值")).toBe(true);
    expect(fires("把这三个数求和：12、30、45")).toBe(true);
    expect(fires("营收从 100 万涨到 120 万，涨了多少")).toBe(true);
  });

  it("does not lose an expression to the question wrapped around it", () => {
    // A missed turn is answered by whatever the model makes up, so these
    // matter more than the false positives below.
    expect(fires("1-2 等于多少")).toBe(true);
    expect(fires("10/4 是多少？")).toBe(true);
    expect(fires("麻烦算一下 1 和 2")).toBe(true);
    expect(fires("请帮忙算下 10/4")).toBe(true);
    expect(fires("100万元和200万元的平均值")).toBe(true);
  });

  it("leaves intent to the planner rather than guessing it from characters", () => {
    // These fire, and that is the design: no pattern over the characters can
    // tell that 机型区别 or 招生区别 is not arithmetic. The cost is one
    // non-streaming planner call, which rule 4 of its prompt answers with an
    // empty array; the answer the user sees is unchanged either way.
    //
    // The alternative — requiring the operation word to sit against the
    // numbers — kept these three out and broke the five above it.
    expect(fires("请计算 2024 和 2025 的机型区别")).toBe(true);
    expect(fires("计算：2026 年和 2027 年的招生区别")).toBe(true);
    expect(fires("2024 和 2025 的平均工资是多少")).toBe(true);
    // Same class: an operation word swallowed by a longer noun. Vetoing these
    // needs a list of nouns that grows once per noun anyone ever writes.
    expect(fires("计算机专业 2026 和 2027 招生区别")).toBe(true);
    expect(fires("计算节点 2024 和 2025 的规格差异")).toBe(true);
    expect(fires("我打算 2026 和 2027 都去")).toBe(true);
    expect(fires("预算 100 万和 200 万怎么分")).toBe(true);
  });

  it("does not spend a blocking planner call on ordinary numeric prose", () => {
    // Every one of these fired before: the gate only counted digits, and the
    // call sits in front of the answer.
    expect(fires("2026年8月14日那次会议讲了什么")).toBe(false);
    expect(fires("2026-08-14 的日报")).toBe(false);
    expect(fires("2026/08/14 发生了什么")).toBe(false);
    expect(fires("iPhone 17 Pro 和 iPhone 16 有什么区别")).toBe(false);
    expect(fires("Next.js 15 和 React 19 有不兼容吗")).toBe(false);
    expect(fires("把第 3 章第 2 节总结一下")).toBe(false);
    expect(fires("第 3-5 章讲了什么")).toBe(false);
    expect(fires("错误码 500 和 502 分别什么意思")).toBe(false);
    expect(fires("GPT-4 和 Claude 3 哪个强")).toBe(false);
    expect(fires("我住在 3 号楼 502 室")).toBe(false);
    expect(fires("会议定在 14:30 到 16:00")).toBe(false);
    expect(fires("电话 010-12345678")).toBe(false);
  });

  it("runs one bounded planning call and injects only locally calculated results", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.stream).toBe(false);
      expect(body.temperature).toBe(0);
      expect(body.tools).toBeUndefined();
      expect(init?.headers).toMatchObject({ "x-agenticx-trace-stage": "chat.calculator" });
      return gatewayJson(
        "```json\n" +
          JSON.stringify({
            calculations: [
              {
                id: "c1",
                operation: "sum",
                operands: ["0.1", "0.2"],
                result: "模型伪造的结果不会被采用",
              },
            ],
          }) +
          "\n```",
      );
    });

    const original = {
      model: "m",
      stream: true,
      tools: [{ type: "function", function: { name: "untrusted" } }],
      messages: [
        { role: "system", content: "existing-context" },
        { role: "user", content: "请计算 0.1 + 0.2" },
      ],
    };
    const prepared = await withCalculatorContext(original, {
      url: "http://gateway.test/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(prepared).not.toBeNull();
    expect(prepared?.tools).toEqual(original.tools);
    const messages = prepared?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain('"value":"0.3"');
    expect(messages[0]?.content).toContain("existing-context");
    expect(messages[0]?.content).not.toContain("模型伪造的结果不会被采用");
    expect(messages).toHaveLength(original.messages.length);
    expect(messages.at(-1)).toEqual(original.messages[1]);
  });

  it("silently preserves the ordinary chat path when no valid calculation exists", async () => {
    const noCall = vi.fn(async () => gatewayJson('{"calculations":[]}'));
    await expect(
      withCalculatorContext(
        { messages: [{ role: "user", content: "对比型号 15 和 16" }] },
        {
          url: "http://gateway.test",
          headers: {},
          fetchImpl: noCall as typeof fetch,
        },
      ),
    ).resolves.toBeNull();

    const invalid = vi.fn(async () => gatewayJson("not json"));
    await expect(
      withCalculatorContext(
        { messages: [{ role: "user", content: "计算 1 + 2" }] },
        {
          url: "http://gateway.test",
          headers: {},
          fetchImpl: invalid as typeof fetch,
        },
      ),
    ).resolves.toBeNull();
  });

  it("lets automatic routing open a turn the pattern would have closed", async () => {
    // "这家公司的毛利率比去年高多少" names no operation word the gate knows and
    // its numbers are in the answer, not the question. The router already read
    // the turn on its way to choosing plain chat; that judgement outranks a
    // pattern that cannot read.
    const question = "去年毛利率 28.5，今年 31.2，高了多少";
    expect(shouldPlanCalculator([{ role: "user", content: question }])).toBe(false);

    const fetchImpl = vi.fn(async () =>
      gatewayJson('{"calculations":[{"id":"c1","operation":"difference","operands":["31.2","28.5"]}]}'),
    );
    const body = await withCalculatorContext(
      { messages: [{ role: "user", content: question }] },
      { url: "https://gw.example", headers: {}, fetchImpl: fetchImpl as typeof fetch },
      { intent: "needed" },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).toContain("2.7");
  });

  it("never lets the hint veto a turn the gate recognised", async () => {
    // The reverse direction is deliberately not wired: one missed field must
    // not silently send an arithmetic question back to mental math.
    const fetchImpl = vi.fn(async () => gatewayJson('{"calculations":[]}'));
    await withCalculatorContext(
      { messages: [{ role: "user", content: "0.1 + 0.2 等于多少" }] },
      { url: "https://gw.example", headers: {}, fetchImpl: fetchImpl as typeof fetch },
      { intent: "not_needed" },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call the planner for ordinary non-numeric chat", async () => {
    const fetchImpl = vi.fn();
    await expect(
      withCalculatorContext(
        { messages: [{ role: "user", content: "帮我润色这句话" }] },
        {
          url: "http://gateway.test",
          headers: {},
          fetchImpl: fetchImpl as typeof fetch,
        },
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("operand anchoring", () => {
  const planner = (calculations: unknown) =>
    vi.fn(async () => gatewayJson(JSON.stringify({ calculations })));

  /** The calculation payload as the model will actually receive it. */
  const injected = (body: unknown) => {
    const messages = (body as { messages: Array<{ role: string; content: string }> })
      .messages;
    const system = messages.find((message) => message.role === "system");
    const json = String(system?.content ?? "").slice(String(system?.content).indexOf("["));
    return JSON.parse(json) as Array<{ operation: string; value: string }>;
  };

  const run = async (userText: string, calculations: unknown) => {
    const fetchImpl = planner(calculations);
    const body = await withCalculatorContext(
      { messages: [{ role: "user", content: userText }] },
      { url: "https://gw.example/v1/chat/completions", headers: {}, fetchImpl },
    );
    return body;
  };

  it("accepts operands the conversation actually stated", async () => {
    const body = await run("1,234.56 加 6789 等于多少", [
      { id: "c1", operation: "sum", operands: ["1,234.56", "6789"] },
    ]);
    expect(body).not.toBeNull();
    const injected = JSON.stringify((body as { messages: unknown[] }).messages);
    expect(injected).toContain("8023.56");
  });

  it("treats a grouped and an ungrouped spelling as the same number", async () => {
    const body = await run("1,234.56 加 1 等于多少", [
      { id: "c1", operation: "sum", operands: ["1234.56", "1"] },
    ]);
    expect(body).not.toBeNull();
  });

  it("drops a calculation whose operand was mis-transcribed", async () => {
    // 1,234.56 read back as 1234.65 — exact arithmetic on the wrong number.
    const body = await run("1,234.56 加 6789 等于多少", [
      { id: "c1", operation: "sum", operands: ["1234.65", "6789"] },
    ]);
    expect(body).toBeNull();
  });

  it("drops a calculation whose operand appears nowhere in the turn", async () => {
    const body = await run("1200 加 300 等于多少", [
      { id: "c1", operation: "sum", operands: ["1200", "999"] },
    ]);
    expect(body).toBeNull();
  });

  it("keeps the anchored calculations and drops only the unanchored ones", async () => {
    const body = await run("1200 加 300，另外 800 的 12.5% 是多少", [
      { id: "c1", operation: "sum", operands: ["1200", "300"] },
      { id: "c2", operation: "percent_of", operands: ["12.5", "999"] },
    ]);
    expect(body).not.toBeNull();
    const injected = JSON.stringify((body as { messages: unknown[] }).messages);
    expect(injected).toContain("1500");
    expect(injected).not.toContain("999");
  });

  it("reads a binary minus as an operator, not as a negative operand", async () => {
    // "1-2" scanned as [1, -2] left the planner's honest difference(1, 2)
    // looking unanchored, and the whole calculation was dropped.
    const body = await run("1-2", [
      { id: "c1", operation: "difference", operands: ["1", "2"] },
    ]);
    expect(body).not.toBeNull();
    expect(injected(body)).toEqual([
      expect.objectContaining({ operation: "difference", value: "-1" }),
    ]);
  });

  it("still anchors a genuine leading negative", async () => {
    const body = await run("-2+3", [
      { id: "c1", operation: "sum", operands: ["-2", "3"] },
    ]);
    expect(body).not.toBeNull();
    expect(injected(body)).toEqual([
      expect.objectContaining({ operation: "sum", value: "1" }),
    ]);
  });

  it("anchors a percentage written with its sign", async () => {
    const body = await run("800 的 12.5% 是多少", [
      { id: "c1", operation: "percent_of", operands: ["12.5", "800"] },
    ]);
    expect(body).not.toBeNull();
    const injected = JSON.stringify((body as { messages: unknown[] }).messages);
    expect(injected).toContain("100");
  });

  it("keeps the arithmetic authoritative while leaving the operands open", async () => {
    // These pull in opposite directions and both are needed. Merging them into
    // one instruction is what made a model quote a ratio to twelve decimals and
    // then use figures it had itself identified as stale.
    const body = await run("1200 加 300 等于多少", [
      { id: "c1", operation: "sum", operands: ["1200", "300"] },
    ]);
    const system = String(
      (body as { messages: Array<{ role: string; content: string }> }).messages.find(
        (message) => message.role === "system",
      )?.content ?? "",
    );
    expect(system).toContain("不要重算");
    expect(system).toContain("可以按语境四舍五入");
    expect(system).toContain("操作数选得对不对由你判断");
    expect(system).toContain("不必迁就下面的结果");
  });

  it("does not let an injected system message anchor the next turn", async () => {
    const fetchImpl = planner([{ id: "c1", operation: "sum", operands: ["4242", "1"] }]);
    const body = await withCalculatorContext(
      {
        messages: [
          { role: "system", content: "## 本轮确定性计算结果\n[{\"value\":\"4242\"}]" },
          { role: "user", content: "再加 1 是多少" },
        ],
      },
      { url: "https://gw.example/v1/chat/completions", headers: {}, fetchImpl },
    );
    expect(body).toBeNull();
  });
});
