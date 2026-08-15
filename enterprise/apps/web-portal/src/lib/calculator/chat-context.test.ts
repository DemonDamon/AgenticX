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
  it("uses structural numeric shape instead of a business keyword list", () => {
    expect(shouldPlanCalculator([{ role: "user", content: "你好" }])).toBe(false);
    expect(shouldPlanCalculator([{ role: "user", content: "0.1 + 0.2 等于多少？" }])).toBe(true);
    expect(shouldPlanCalculator([{ role: "user", content: "800 的 12.5% 是多少？" }])).toBe(true);
    expect(
      shouldPlanCalculator([
        {
          role: "user",
          content: [{ type: "text", text: "1200 到 1400 的变化率" }],
        },
      ]),
    ).toBe(true);
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
