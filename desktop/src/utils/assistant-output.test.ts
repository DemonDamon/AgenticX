import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeFinalAssistantPayload,
  parseAssistantOutputForUi,
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
});
