import { describe, expect, it } from "vitest";

import { parseEvalItems } from "../eval-dataset-parse";

describe("parseEvalItems", () => {
  it("reads camelCase JSON and tool name objects", () => {
    const parsed = parseEvalItems(
      "json",
      JSON.stringify([
        { query: "周报", expectedAnswer: "汇总", expectedToolTrace: [{ tool_name: "file_write" }], tags: ["a"] },
      ]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]).toMatchObject({
      query: "周报",
      expected_answer: "汇总",
      expected_tool_trace: ["file_write"],
      tags: ["a"],
    });
  });

  it("reads JSONL", () => {
    const parsed = parseEvalItems("jsonl", '{"query":"一"}\n\n{"query":"二"}\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.items.map((item) => item.query)).toEqual(["一", "二"]);
  });

  it("reads quoted CSV fields that contain newlines", () => {
    const parsed = parseEvalItems("csv", 'query,expected_answer\n"hello\nworld","答"\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]?.query).toBe("hello\nworld");
    expect(parsed.items[0]?.expected_answer).toBe("答");
  });

  it("reports a missing query on the second item", () => {
    const parsed = parseEvalItems("json", JSON.stringify([{ query: "ok" }, { expectedAnswer: "x" }]));
    expect(parsed.errors).toContain("第 2 条：缺少 query");
  });

  it("rejects 501 items", () => {
    const parsed = parseEvalItems("json", JSON.stringify(Array.from({ length: 501 }, () => ({ query: "q" }))));
    expect(parsed.errors).toContain("最多 500 条");
  });

  it("rejects a CSV without a query column", () => {
    const parsed = parseEvalItems("csv", "name,note\na,b\n");
    expect(parsed.errors).toEqual(["CSV 缺少 query 列"]);
  });
});
