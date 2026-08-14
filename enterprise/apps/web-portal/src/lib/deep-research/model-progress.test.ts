import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_PROGRESS_CHARS,
  modelProgressSnapshot,
  splitInlineModelProgress,
} from "./model-progress";

describe("model progress", () => {
  it("prefers provider reasoning over visible draft output", () => {
    expect(modelProgressSnapshot("正文草稿", "先核对证据")).toEqual({
      text: "先核对证据",
      kind: "reasoning",
    });
  });

  it("extracts inline think blocks without leaking tags", () => {
    expect(splitInlineModelProgress("<think>先比较三组证据</think>正文结论")).toEqual({
      reasoning: "先比较三组证据",
      output: "正文结论",
    });
  });

  it("falls back to draft output and keeps only a bounded tail", () => {
    const snapshot = modelProgressSnapshot("x".repeat(MAX_MODEL_PROGRESS_CHARS + 50));
    expect(snapshot?.kind).toBe("draft");
    expect(snapshot?.text).toHaveLength(MAX_MODEL_PROGRESS_CHARS);
    expect(snapshot?.text.startsWith("…")).toBe(true);
  });

  it("does not flash an incomplete think tag", () => {
    expect(modelProgressSnapshot("<thi")).toBeNull();
  });
});
