import { describe, expect, it } from "vitest";

import { hasExclusiveHarnessMark, harnessMarkSrc } from "./harness-marks";

describe("harness-marks", () => {
  it("exposes exclusive SVGs for Damon harnesses", () => {
    for (const id of [
      "claude-code",
      "codebuddy",
      "codex",
      "opencode",
      "deepseek",
      "hermes-agent",
      "pi-agent",
      "openclaw",
    ]) {
      expect(hasExclusiveHarnessMark(id)).toBe(true);
      expect(String(harnessMarkSrc(id))).toMatch(/svg/i);
    }
  });

  it("AgenticX has no exclusive SVG (Bot fallback)", () => {
    expect(hasExclusiveHarnessMark("python-agent")).toBe(false);
    expect(harnessMarkSrc("python-agent")).toBeNull();
  });
});
