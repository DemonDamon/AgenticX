import { describe, expect, it } from "vitest";

import {
  harnessBadgeFallbackLabel,
  harnessDisplayKind,
  resolveMessageHarnessId,
} from "./harness-display";

describe("harness-display", () => {
  it("resolves harness from message metadata aliases", () => {
    expect(resolveMessageHarnessId({ harness: "claude-code" })).toBe("claude-code");
    expect(resolveMessageHarnessId({ harness_id: "codebuddy" })).toBe("codebuddy");
    expect(resolveMessageHarnessId({ harnessId: "python-agent" })).toBe("python-agent");
    expect(resolveMessageHarnessId({})).toBeNull();
  });

  it("maps builtin to AgenticX labels", () => {
    expect(harnessDisplayKind("python-agent")).toBe("agenticx");
    expect(harnessBadgeFallbackLabel("python-agent")).toBe("AgenticX");
    expect(harnessBadgeFallbackLabel("claude-code")).toBe("Claude Code");
    expect(harnessBadgeFallbackLabel("codebuddy")).toBe("CodeBuddy");
  });
});
