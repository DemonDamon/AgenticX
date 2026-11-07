import { describe, expect, it } from "vitest";

import { hasExclusiveHarnessMark, harnessMarkSrc } from "./harness-marks";

describe("harness-marks", () => {
  it("exposes exclusive marks for Damon harnesses + Near AgenticX", () => {
    for (const id of [
      "python-agent",
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
      expect(String(harnessMarkSrc(id))).toMatch(/svg|png|image/i);
    }
  });

  it("AgenticX uses Near app icon asset", () => {
    const src = String(harnessMarkSrc("python-agent") ?? "");
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/png|image/i);
  });
});
