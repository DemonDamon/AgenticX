import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantVisibleBodyForUi,
  buildCommittedAssistantPatch,
  normalizeFinalAssistantPayload,
  parseAssistantOutputForUi,
  reasoningDuplicatesVisibleBody,
  sanitizeSuggestedQuestions,
} from "./assistant-output";

type FixtureCase = {
  name: string;
  raw: string;
  reasoning: string;
  visible_body: string;
  suggested_questions: string[];
  protocol_errors: string[];
  malformed: boolean;
};

const fixturePath = path.resolve(
  process.cwd(),
  "../tests/fixtures/assistant_output_protocol_cases.json",
);

function loadCases(): FixtureCase[] {
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as FixtureCase[];
}

describe("assistant-output shared fixture", () => {
  it("matches Python golden oracle for every case", () => {
    for (const c of loadCases()) {
      const parsed = parseAssistantOutputForUi(c.raw);
      expect(parsed.reasoning, c.name).toBe(c.reasoning);
      expect(parsed.visibleBody, c.name).toBe(c.visible_body);
      expect(parsed.suggestedQuestions, c.name).toEqual(c.suggested_questions);
      expect(parsed.protocolErrors, c.name).toEqual(c.protocol_errors);
      expect(parsed.malformed, c.name).toBe(c.malformed);
    }
  });
});

describe("sanitizeSuggestedQuestions", () => {
  it("rejects empty body and wrong counts", () => {
    expect(sanitizeSuggestedQuestions(["a", "b", "c"], "")).toEqual([]);
    expect(sanitizeSuggestedQuestions(["a", "b"], "body")).toEqual([]);
    expect(sanitizeSuggestedQuestions(["|a|b|", "b", "c"], "body")).toEqual([]);
  });

  it("keeps three valid lines", () => {
    expect(sanitizeSuggestedQuestions(["问题1", "问题2", "问题3"], "正文")).toEqual([
      "问题1",
      "问题2",
      "问题3",
    ]);
  });
});

describe("normalizeFinalAssistantPayload", () => {
  it("returns authoritative non-empty final", () => {
    const out = normalizeFinalAssistantPayload(
      "最终正文",
      ["问题1", "问题2", "问题3"],
      true,
      "model_final",
    );
    expect(out.text).toBe("最终正文");
    expect(out.suggestedQuestions).toEqual(["问题1", "问题2", "问题3"]);
    expect(out.incomplete).toBe(false);
    expect(out.turnTerminal).toBe(true);
  });

  it("marks empty final incomplete and drops SQ", () => {
    const out = normalizeFinalAssistantPayload(
      "",
      ["问题1", "问题2", "问题3"],
      true,
      "empty_response_fallback",
    );
    expect(out.text).toBe("");
    expect(out.suggestedQuestions).toEqual([]);
    expect(out.incomplete).toBe(true);
  });

  it("drops detached SQ for malformed body", () => {
    const out = normalizeFinalAssistantPayload(
      "<think>r<followups>x</think>\n**标题**\n|a|b|\n</followups>",
      ["问题1", "问题2", "问题3"],
      true,
      "malformed_model_final_recovered",
    );
    expect(out.suggestedQuestions).toEqual([]);
    expect(out.incomplete).toBe(true);
  });

  // Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
  it("keeps the public body but strips an unclosed followups tail", () => {
    const raw =
      "全部修复完成。\n粒子间距离 < 120px 时自动连线。\n<followups>粒子动画太卡了怎么优化\n待办事项能不能按分类筛选\n背景粒子颜色能不能换成其他配色";
    const out = normalizeFinalAssistantPayload(
      raw,
      undefined,
      true,
      "malformed_model_final_recovered",
    );
    expect(out.text).toBe("全部修复完成。\n粒子间距离 < 120px 时自动连线。");
    expect(assistantVisibleBodyForUi(raw)).toBe("全部修复完成。\n粒子间距离 < 120px 时自动连线。\n");
    expect(out.suggestedQuestions).toEqual([]);
    expect(out.incomplete).toBe(false);
  });
});

// Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
describe("buildCommittedAssistantPatch", () => {
  it("replaces provisional content with the authoritative final body", () => {
    expect(
      buildCommittedAssistantPatch(
        "科技风改造完成！",
        { reasoning: "文件完整性验证通过。", metadata: { turn_terminal: true } },
        true,
      ),
    ).toEqual({
      content: "科技风改造完成！",
      reasoning: "文件完整性验证通过。",
      metadata: { turn_terminal: true },
    });
  });

  it("does not overwrite content before a final event", () => {
    expect(
      buildCommittedAssistantPatch("临时流内容", { metadata: { turn_terminal: false } }, false),
    ).toEqual({ metadata: { turn_terminal: false } });
  });

  it("drops reasoning that only echoes the final body", () => {
    const body = "## 总结\n\n当前目录有两个 .py 文件。";
    expect(
      buildCommittedAssistantPatch(
        body,
        { reasoning: body, reasoningSeconds: 5, metadata: { turn_terminal: true } },
        true,
      ),
    ).toEqual({
      content: body,
      metadata: { turn_terminal: true },
    });
  });
});

describe("reasoningDuplicatesVisibleBody", () => {
  it("detects exact trimmed echoes", () => {
    expect(reasoningDuplicatesVisibleBody(" 答案 ", "答案\n")).toBe(true);
    expect(reasoningDuplicatesVisibleBody("先读文件", "答案")).toBe(false);
  });
});
