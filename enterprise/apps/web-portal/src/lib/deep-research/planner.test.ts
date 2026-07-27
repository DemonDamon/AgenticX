import { describe, expect, it, vi } from "vitest";
import { buildResearchPlan, parseResearchPlanJson, MAX_SUB_QUESTIONS } from "./planner";

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

  it("truncates to MAX_SUB_QUESTIONS", () => {
    const many = Array.from({ length: 8 }, (_, i) => `q${i + 1}`);
    const plan = parseResearchPlanJson(
      JSON.stringify({ topic: "T", sub_questions: many }),
      "fallback",
    );
    expect(plan.subQuestions).toHaveLength(MAX_SUB_QUESTIONS);
    expect(plan.subQuestions).toEqual(["q1", "q2", "q3", "q4", "q5"]);
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
});
