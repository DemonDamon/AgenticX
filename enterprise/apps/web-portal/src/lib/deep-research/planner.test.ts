import { describe, expect, it, vi } from "vitest";
import {
  buildResearchPlan,
  enforcePlanBreadth,
  parseResearchPlanJson,
  MAX_SUB_QUESTIONS,
  OPEN_ENDED_MIN_LANES,
} from "./planner";

describe("parseResearchPlanJson", () => {
  it("parses standard JSON", () => {
    const plan = parseResearchPlanJson(
      JSON.stringify({
        topic: "开源大模型",
        sub_questions: ["能力对比", "Agent 工具", "部署成本"],
      }),
      "调研开源大模型",
    );
    expect(plan.topic).toBe("开源大模型");
    expect(plan.subQuestions).toEqual(["能力对比", "Agent 工具", "部署成本"]);
  });

  it("keeps every lane when the model prefixes a think block", () => {
    const raw = `<think>该拆几条？也许 {3} 条吧</think>${JSON.stringify({
      topic: "T",
      sub_questions: ["A", "B", "C", "D"],
    })}`;
    const plan = parseResearchPlanJson(raw, "fallback");
    expect(plan.topic).toBe("T");
    expect(plan.subQuestions).toEqual(["A", "B", "C", "D"]);
  });

  it("extracts JSON from markdown fences", () => {
    const plan = parseResearchPlanJson(
      '```json\n{"topic":"T","sub_questions":["A","B","C"]}\n```',
      "fallback",
    );
    expect(plan.topic).toBe("T");
    expect(plan.subQuestions).toEqual(["A", "B", "C"]);
  });

  it("degrades natural language to a single question without throwing", () => {
    const plan = parseResearchPlanJson("抱歉，我无法输出 JSON", "原始问题");
    expect(plan.topic).toBe("原始问题");
    expect(plan.subQuestions).toEqual(["原始问题"]);
  });

  it("keeps up to MAX_SUB_QUESTIONS lanes for complex topics", () => {
    const many = Array.from({ length: 8 }, (_, i) => `q${i + 1}`);
    const plan = parseResearchPlanJson(
      JSON.stringify({ topic: "T", complexity: "complex", sub_questions: many }),
      "fallback",
    );
    expect(plan.subQuestions).toHaveLength(8);
    expect(plan.complexity).toBe("complex");
  });

  it("keeps a short plan short instead of padding to a fixed count", () => {
    const plan = parseResearchPlanJson(
      JSON.stringify({ topic: "T", complexity: "simple", sub_questions: ["A", "B"] }),
      "fallback",
    );
    expect(plan.subQuestions).toEqual(["A", "B"]);
    expect(plan.complexity).toBe("simple");
  });

  it("truncates beyond MAX_SUB_QUESTIONS", () => {
    const many = Array.from({ length: 10 }, (_, i) => `q${i + 1}`);
    const plan = parseResearchPlanJson(
      JSON.stringify({ topic: "T", sub_questions: many }),
      "fallback",
    );
    expect(plan.subQuestions).toHaveLength(MAX_SUB_QUESTIONS);
    expect(plan.subQuestions.at(-1)).toBe(`q${MAX_SUB_QUESTIONS}`);
  });

  it("defaults complexity to moderate when absent or invalid", () => {
    const missing = parseResearchPlanJson(
      JSON.stringify({ topic: "T", sub_questions: ["A"] }),
      "fallback",
    );
    expect(missing.complexity).toBe("moderate");
    const invalid = parseResearchPlanJson(
      JSON.stringify({ topic: "T", complexity: "epic", sub_questions: ["A"] }),
      "fallback",
    );
    expect(invalid.complexity).toBe("moderate");
  });

  it("deduplicates sub-questions", () => {
    const plan = parseResearchPlanJson(
      JSON.stringify({
        topic: "T",
        sub_questions: ["同一问题", "同一问题", "另一问题", " 同一问题 "],
      }),
      "fallback",
    );
    expect(plan.subQuestions).toEqual(["同一问题", "另一问题"]);
  });
});

describe("enforcePlanBreadth", () => {
  it("expands a collapsed open-ended plan into facet lanes", () => {
    const plan = enforcePlanBreadth(
      {
        topic: "deepseek v4 核心技术点",
        complexity: "simple",
        subQuestions: ["deepseek v4 核心技术点"],
      },
      "deepseek v4 核心技术点",
    );
    expect(plan.subQuestions.length).toBeGreaterThanOrEqual(OPEN_ENDED_MIN_LANES);
    expect(plan.complexity).toBe("moderate");
    expect(plan.subQuestions.every((q) => q !== "deepseek v4 核心技术点")).toBe(true);
  });

  it("leaves a already-broad plan alone", () => {
    const subQuestions = ["架构", "训练", "推理", "评测"];
    const plan = enforcePlanBreadth(
      { topic: "T", complexity: "moderate", subQuestions },
      "deepseek v4 核心技术点",
    );
    expect(plan.subQuestions).toEqual(subQuestions);
  });
});

describe("buildResearchPlan", () => {
  it("uses gateway JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: "主题",
                sub_questions: ["子问1", "子问2", "子问3"],
              }),
            },
          },
        ],
      }),
    });

    const plan = await buildResearchPlan({
      url: "http://gw/v1/chat/completions",
      headers: { authorization: "Bearer x" },
      body: { model: "m" },
      userQuery: "用户问题",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(plan.subQuestions).toEqual(["子问1", "子问2", "子问3"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { stream: boolean };
    expect(body.stream).toBe(false);
  });

  it("injects today's date and recon brief as system grounding", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"topic":"T","sub_questions":["A"]}' } }],
      }),
    });

    await buildResearchPlan({
      url: "http://gw/v1/chat/completions",
      headers: {},
      body: { model: "m" },
      userQuery: "用户问题",
      todayLine: "今天是 2026-08-02（UTC+8）。",
      reconBrief: "【检索到的现状】- 已发布",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toHaveLength(4);
    expect(body.messages[1]?.content).toContain("2026-08-02");
    expect(body.messages[2]?.content).toContain("已发布");
    expect(body.messages[3]?.role).toBe("user");
  });

  it("omits grounding messages when recon produced nothing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"topic":"T","sub_questions":["A"]}' } }],
      }),
    });

    await buildResearchPlan({
      url: "http://gw/v1/chat/completions",
      headers: {},
      body: { model: "m" },
      userQuery: "用户问题",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { messages: unknown[] };
    expect(body.messages).toHaveLength(2);
  });
});
