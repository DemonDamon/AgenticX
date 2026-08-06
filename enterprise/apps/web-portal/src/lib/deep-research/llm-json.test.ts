import { describe, expect, it } from "vitest";

import { extractJsonText, parseLlmJson } from "./llm-json";

const OPEN = "<" + "think" + ">";
const CLOSE = "<" + "/" + "think" + ">";

describe("parseLlmJson", () => {
  it("parses plain JSON", () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("skips a closed think block and keeps the payload after it", () => {
    const raw = `${OPEN}先想想 {"a":1} 这个不对${CLOSE}{"b":2}`;
    expect(parseLlmJson(raw)).toEqual({ b: 2 });
  });

  it("recovers JSON that trails an unclosed think block", () => {
    const raw = `${OPEN}模型忘了闭合标签\n{"needed":true,"questions":[]}`;
    expect(parseLlmJson(raw)).toEqual({ needed: true, questions: [] });
  });

  it("ignores prose around the payload", () => {
    expect(parseLlmJson('好的，结果如下：\n{"a":1}\n希望有帮助。')).toEqual({ a: 1 });
  });

  it("handles braces inside string literals", () => {
    expect(parseLlmJson('{"q":"a } b","n":2}')).toEqual({ q: "a } b", n: 2 });
  });

  it("handles escaped quotes inside string literals", () => {
    expect(parseLlmJson('{"q":"say \\"hi\\" }","n":2}')).toEqual({ q: 'say "hi" }', n: 2 });
  });

  it("parses top-level arrays", () => {
    expect(parseLlmJson(`${OPEN}x${CLOSE}[{"query":"a","kind":"primary"}]`)).toEqual([
      { query: "a", kind: "primary" },
    ]);
  });

  it("returns null for non-JSON input", () => {
    expect(parseLlmJson("完全没有 JSON")).toBeNull();
    expect(parseLlmJson("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseLlmJson('{"a":')).toBeNull();
  });
});

describe("extractJsonText", () => {
  it("returns empty string for blank input", () => {
    expect(extractJsonText("")).toBe("");
  });

  it("strips think and fence together", () => {
    const raw = `${OPEN}reasoning${CLOSE}\n\`\`\`json\n{"a":1}\n\`\`\``;
    expect(extractJsonText(raw)).toBe('{"a":1}');
  });
});
