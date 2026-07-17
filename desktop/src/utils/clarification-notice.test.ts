import { describe, expect, it } from "vitest";
import {
  buildClarificationAnswerText,
  isClarificationMessage,
  clarificationPayloadFromMeta,
  parseClarificationDecisions,
  toggleDecisionSelection,
  type ClarificationDecisionPayload,
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

describe("parseClarificationDecisions", () => {
  it("defaults legacy decisions to single with empty exclusive options", () => {
    expect(
      parseClarificationDecisions([
        { id: "tone", question: "整体语气选择？", options: ["专业克制", "轻松活泼"] },
      ]),
    ).toEqual([
      {
        id: "tone",
        question: "整体语气选择？",
        options: ["专业克制", "轻松活泼"],
        selectionMode: "single",
        exclusiveOptions: [],
      },
    ]);
  });

  it("parses multiple mode with valid exclusive options", () => {
    expect(
      parseClarificationDecisions([
        {
          id: "scope",
          question: "系统提示是否需要调整？",
          options: ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
          selection_mode: "multiple",
          exclusive_options: ["直接采用上面草案"],
        },
      ]),
    ).toEqual([
      {
        id: "scope",
        question: "系统提示是否需要调整？",
        options: ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
        selectionMode: "multiple",
        exclusiveOptions: ["直接采用上面草案"],
      },
    ]);
  });

  it("falls back to single for illegal selection_mode", () => {
    const out = parseClarificationDecisions([
      {
        question: "选一个",
        options: ["A", "B"],
        selection_mode: "multi",
        exclusive_options: ["A"],
      },
    ]);
    expect(out[0]?.selectionMode).toBe("single");
    expect(out[0]?.exclusiveOptions).toEqual([]);
  });

  it("filters, dedupes exclusive options while preserving option-order membership", () => {
    const out = parseClarificationDecisions([
      {
        question: "选多个",
        options: ["A", "B", "C"],
        selection_mode: "multiple",
        exclusive_options: ["A", "A", "  ", "Z", "B"],
      },
    ]);
    expect(out[0]?.selectionMode).toBe("multiple");
    expect(out[0]?.exclusiveOptions).toEqual(["A", "B"]);
  });
});

describe("toggleDecisionSelection", () => {
  const single: ClarificationDecisionPayload = {
    id: "tone",
    question: "语气",
    options: ["专业克制", "轻松活泼"],
    selectionMode: "single",
    exclusiveOptions: [],
  };

  const multiple: ClarificationDecisionPayload = {
    id: "scope",
    question: "范围",
    options: ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
    selectionMode: "multiple",
    exclusiveOptions: ["直接采用上面草案"],
  };

  it("single: selects exclusively and clears on second click", () => {
    expect(toggleDecisionSelection(single, [], "专业克制")).toEqual(["专业克制"]);
    expect(toggleDecisionSelection(single, ["专业克制"], "轻松活泼")).toEqual(["轻松活泼"]);
    expect(toggleDecisionSelection(single, ["轻松活泼"], "轻松活泼")).toEqual([]);
  });

  it("multiple: accumulates and removes normal options", () => {
    expect(toggleDecisionSelection(multiple, [], "补充硬件监控")).toEqual(["补充硬件监控"]);
    expect(toggleDecisionSelection(multiple, ["补充硬件监控"], "补充模型架构设计")).toEqual([
      "补充硬件监控",
      "补充模型架构设计",
    ]);
    expect(
      toggleDecisionSelection(multiple, ["补充硬件监控", "补充模型架构设计"], "补充硬件监控"),
    ).toEqual(["补充模型架构设计"]);
  });

  it("multiple exclusive clears normal options", () => {
    expect(
      toggleDecisionSelection(multiple, ["补充硬件监控", "补充模型架构设计"], "直接采用上面草案"),
    ).toEqual(["直接采用上面草案"]);
  });

  it("multiple normal options clear exclusive options", () => {
    expect(toggleDecisionSelection(multiple, ["直接采用上面草案"], "补充硬件监控")).toEqual([
      "补充硬件监控",
    ]);
  });

  it("output always follows options order, not click order", () => {
    expect(toggleDecisionSelection(multiple, ["补充模型架构设计"], "补充硬件监控")).toEqual([
      "补充硬件监控",
      "补充模型架构设计",
    ]);
  });

  it("exclusive option clears itself on second click", () => {
    expect(toggleDecisionSelection(multiple, ["直接采用上面草案"], "直接采用上面草案")).toEqual([]);
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

  it("preserves multiselect fields from decisions metadata", () => {
    const payload = clarificationPayloadFromMeta(
      {
        kind: "clarification",
        request_id: "req-ms",
        prompt: "请确认",
        options: [],
        decisions: [
          {
            id: "scope",
            question: "系统提示是否需要调整？",
            options: ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
            selection_mode: "multiple",
            exclusive_options: ["直接采用上面草案"],
          },
        ],
      },
      "meta",
      "sess-2",
    );
    expect(payload?.decisions).toEqual([
      {
        id: "scope",
        question: "系统提示是否需要调整？",
        options: ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
        selectionMode: "multiple",
        exclusiveOptions: ["直接采用上面草案"],
      },
    ]);
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
