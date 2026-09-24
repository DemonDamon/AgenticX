import { describe, expect, it } from "vitest";

import { assistVisibleText, parseReasoningContent } from "./reasoning-parser";

// Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
describe("parseReasoningContent", () => {
  it("separates a canonical reasoning block from the response", () => {
    expect(parseReasoningContent("<think>内部推理</think>最终正文")).toEqual({
      reasoning: "内部推理",
      response: "最终正文",
      hasReasoningTag: true,
    });
  });

  it("drops standalone and repeated closing tags from visible text", () => {
    expect(
      parseReasoningContent("好，我来添加功能\n\n</think>\n</think>\n</think>"),
    ).toEqual({
      reasoning: "",
      response: "好，我来添加功能",
      hasReasoningTag: false,
    });
  });

  it("drops a stray close before a later canonical block", () => {
    expect(parseReasoningContent("前文</think><think>推理</think>正文")).toEqual({
      reasoning: "推理",
      response: "前文正文",
      hasReasoningTag: true,
    });
  });
});

describe("assistVisibleText", () => {
  it("keeps only the answer after a think block", () => {
    expect(
      assistVisibleText("<think>先想回复风格</think>\n直接给结论，少客套。"),
    ).toBe("直接给结论，少客套。");
  });

  it("drops an unclosed think block instead of saving it", () => {
    expect(assistVisibleText("<think>用户要求生成偏好描述")).toBe("");
  });

  it("drops redacted thinking wrappers", () => {
    expect(assistVisibleText("<redacted_thinking>secret</redacted_thinking>\n用表格。")).toBe(
      "用表格。",
    );
  });
});
