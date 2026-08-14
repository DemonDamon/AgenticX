import { describe, expect, it } from "vitest";
import {
  MAX_GAPS,
  MAX_QUERIES_PER_GAP,
  parseGapsJson,
  reflectOnGaps,
} from "./reflector";

describe("parseGapsJson", () => {
  it("parses fenced gaps", () => {
    const raw = `\`\`\`json
{"gaps":[{"id":"g1","description":"缺官方论文","queries":["deepseek paper"]}]}
\`\`\``;
    const gaps = parseGapsJson(raw);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.description).toContain("官方");
  });

  it("parses gaps when the model prefixes a think block", () => {
    const raw = `<think>还缺什么？{也许缺论文}</think>{"gaps":[{"id":"g1","description":"缺官方论文","queries":["deepseek paper"]}]}`;
    const gaps = parseGapsJson(raw);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.queries).toEqual(["deepseek paper"]);
  });

  it("returns empty on empty gaps or invalid json", () => {
    expect(parseGapsJson('{"gaps":[]}')).toEqual([]);
    expect(parseGapsJson("nope")).toEqual([]);
  });

  it("drops gaps without queries and truncates to MAX_GAPS", () => {
    const gaps = Array.from({ length: MAX_GAPS + 2 }, (_, i) => ({
      id: `g${i}`,
      description: `缺口${i}`,
      queries: i === 1 ? [] : [`q${i}`],
    }));
    const parsed = parseGapsJson(JSON.stringify({ gaps }));
    expect(parsed.length).toBeLessThanOrEqual(MAX_GAPS);
    expect(parsed.every((g) => g.queries.length > 0)).toBe(true);
  });

  it("deduplicates crowded facets and caps one gap to the shared query budget", () => {
    const parsed = parseGapsJson(
      JSON.stringify({
        gaps: [
          {
            id: "g1",
            description: "补齐不同评测条件下的实际表现",
            queries: [
              "模型 A 版本 V 基准 X 成绩",
              "  模型 A 版本 V 基准 X 成绩  ",
              "模型 A 版本 V 基准 Y 成绩",
              "模型 A 版本 V 硬件 H 推理性能",
              "模型 A 版本 V 额外查询",
            ],
          },
        ],
      }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.queries).toEqual([
      "模型 A 版本 V 基准 X 成绩",
      "模型 A 版本 V 基准 Y 成绩",
      "模型 A 版本 V 硬件 H 推理性能",
    ]);
    expect(parsed[0]?.queries).toHaveLength(MAX_QUERIES_PER_GAP);
  });

  it("asks only for answer-changing, self-contained searchable gaps", async () => {
    let prompt = "";
    await reflectOnGaps({
      topic: "某模型的实际表现",
      todayLine: "当前日期：2026-08-14",
      laneMemos: [{ question: "公开评测", memo: "已有初步成绩" }],
      callJson: async (messages) => {
        prompt = messages.map((message) => message.content).join("\n");
        return '{"gaps":[]}';
      },
    });
    expect(prompt).toContain("会实质改变");
    expect(prompt).toContain("当前备忘尚未回答");
    expect(prompt).toContain("每条 queries 都必须自包含");
    expect(prompt).toContain("默认只给 1 条");
    expect(prompt).toContain("禁止输出");
  });
});
