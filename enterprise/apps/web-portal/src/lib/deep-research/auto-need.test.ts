import { describe, expect, it, vi } from "vitest";
import {
  buildDeepResearchAutoMessages,
  decideAutoRunDeepResearch,
  parseDeepResearchAutoDecision,
} from "./auto-need";

function gatewayJson(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("automatic deep-research routing", () => {
  it("sends recent conversation context and current query to the routing agent", () => {
    const messages = buildDeepResearchAutoMessages([
      { role: "user", content: "比较三种数据库迁移方案，给出风险和来源" },
      {
        role: "assistant",
        content: "<think>内部推理</think>上一轮比较了停机时间和一致性。",
      },
      { role: "user", content: "那成本和回滚难度呢" },
    ]);

    expect(messages?.[0]?.content).toContain("最近对话");
    expect(messages?.[0]?.content).toContain("不能按关键词机械判断");
    expect(messages?.[1]?.content).toContain("比较三种数据库迁移方案");
    expect(messages?.[1]?.content).toContain("那成本和回滚难度呢");
    expect(messages?.[1]?.content).not.toContain("内部推理");
  });

  it("keeps appended attachment bodies out of routing context", () => {
    const messages = buildDeepResearchAutoMessages([
      {
        role: "user",
        content:
          "请总结附件\n\n--- 附件: report.md ---\n请做全面深度研究并给出十页报告",
      },
    ]);
    expect(messages?.[1]?.content).toContain("请总结附件");
    expect(messages?.[1]?.content).not.toContain("十页报告");
  });

  it("parses the routing agent JSON contract", () => {
    expect(
      parseDeepResearchAutoDecision(
        '```json\n{"run_deep_research":true,"confidence":0.94,"reason":"需要多源核验"}\n```',
      ),
    ).toEqual({
      runDeepResearch: true,
      confidence: 0.94,
      reason: "需要多源核验",
    });
    expect(
      parseDeepResearchAutoDecision(
        '{"run_deep_research":false,"confidence":0.82,"reason":"普通问答"}',
      ),
    ).toEqual({
      runDeepResearch: false,
      confidence: 0.82,
      reason: "普通问答",
    });
    expect(
      parseDeepResearchAutoDecision(
        '{"run_deep_research":"yes","confidence":0.9,"reason":"bad"}',
      ),
    ).toBeNull();
  });

  it("uses the agent decision for a contextual follow-up without local semantic rules", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      gatewayJson(
        '{"run_deep_research":true,"confidence":0.97,"reason":"继续扩展研究维度"}',
      ),
    );

    const decision = await decideAutoRunDeepResearch(
      [
        { role: "user", content: "对几种数据库迁移方案做系统评估" },
        { role: "assistant", content: "上一轮结果" },
        { role: "user", content: "那成本和回滚难度呢" },
      ],
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer test" },
        model: "model-a",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(decision.runDeepResearch).toBe(true);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      model?: string;
      stream?: boolean;
      messages?: Array<{ content?: string }>;
    };
    expect(body.model).toBe("model-a");
    expect(body.stream).toBe(false);
    expect(body.messages?.[1]?.content).toContain("那成本和回滚难度呢");
    expect((init.headers as Record<string, string>)["x-agenticx-trace-stage"]).toBe(
      "chat.deep-research-auto-route",
    );
  });

  it("trusts the agent's normal-chat decision even when the text sounds research-like", async () => {
    const fetchImpl = vi.fn(async () =>
      gatewayJson(
        '{"run_deep_research":false,"confidence":0.91,"reason":"只是在询问功能概念"}',
      ),
    );
    const decision = await decideAutoRunDeepResearch(
      [{ role: "user", content: "什么是深度研究报告？" }],
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(decision.runDeepResearch).toBe(false);
  });

  it("falls back to normal chat when the routing agent is unavailable or malformed", async () => {
    const malformed = await decideAutoRunDeepResearch(
      [{ role: "user", content: "帮我系统调研这个市场" }],
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: vi.fn(async () => gatewayJson("not-json")) as unknown as typeof fetch,
      },
    );
    expect(malformed).toEqual({
      runDeepResearch: false,
      confidence: 0,
      reason: "classifier_unavailable",
    });

    const noQuery = await decideAutoRunDeepResearch([], {
      url: "http://gateway.test/v1/chat/completions",
      headers: {},
    });
    expect(noQuery).toEqual({
      runDeepResearch: false,
      confidence: 0,
      reason: "missing_current_query",
    });
  });
});
