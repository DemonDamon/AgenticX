import { describe, expect, it } from "vitest";
import {
  buildClarificationAnswerText,
  isClarificationMessage,
  clarificationPayloadFromMeta,
} from "./clarification-notice";

describe("buildClarificationAnswerText", () => {
  it("joins selected options and free text", () => {
    expect(
      buildClarificationAnswerText({ answerText: "配色用深蓝紫+科技金", selectedOptions: ["锁定 2 分钟"] }),
    ).toBe("用户选择：锁定 2 分钟；自定义补充：配色用深蓝紫+科技金。");
  });

  it("renders only options when no free text", () => {
    expect(buildClarificationAnswerText({ answerText: "", selectedOptions: ["A", "B"] })).toBe(
      "用户选择：A；B。",
    );
  });

  it("renders only free text when no options", () => {
    expect(buildClarificationAnswerText({ answerText: "自由文本", selectedOptions: [] })).toBe(
      "自定义补充：自由文本。",
    );
  });

  it("falls back to default-plan text when both empty", () => {
    expect(buildClarificationAnswerText({ answerText: "", selectedOptions: [] })).toContain("默认方案");
  });

  it("filters blank entries", () => {
    expect(
      buildClarificationAnswerText({ answerText: "  ", selectedOptions: ["A", "", "  "] }),
    ).toBe("用户选择：A。");
  });
});

describe("isClarificationMessage", () => {
  it("returns true for kind=clarification", () => {
    expect(isClarificationMessage({ kind: "clarification" })).toBe(true);
  });

  it("returns false for other kinds", () => {
    expect(isClarificationMessage({ kind: "turn_interrupted" })).toBe(false);
    expect(isClarificationMessage(null)).toBe(false);
    expect(isClarificationMessage(undefined)).toBe(false);
    expect(isClarificationMessage("clarification")).toBe(false);
  });
});

describe("clarificationPayloadFromMeta", () => {
  it("builds payload from persisted metadata", () => {
    const payload = clarificationPayloadFromMeta(
      {
        kind: "clarification",
        request_id: "req-123",
        prompt: "时长是否锁定 2 分钟？",
        options: ["锁定 2 分钟", "改为 3 分钟"],
        allow_free_text: true,
      },
      "avatar-1",
      "sess-1",
    );
    expect(payload).toEqual({
      requestId: "req-123",
      prompt: "时长是否锁定 2 分钟？",
      options: ["锁定 2 分钟", "改为 3 分钟"],
      allowFreeText: true,
      agentId: "avatar-1",
      sessionId: "sess-1",
      context: undefined,
    });
  });

  it("returns null when request_id missing", () => {
    expect(
      clarificationPayloadFromMeta({ kind: "clarification", prompt: "q" }, "a", "s"),
    ).toBeNull();
  });

  it("returns null for non-clarification metadata", () => {
    expect(clarificationPayloadFromMeta({ kind: "other" }, "a", "s")).toBeNull();
  });

  it("defaults allow_free_text to true when not false", () => {
    const payload = clarificationPayloadFromMeta(
      { kind: "clarification", request_id: "r1", prompt: "q" },
      "a",
      "s",
    );
    expect(payload?.allowFreeText).toBe(true);
  });
});
