import { describe, expect, it } from "vitest";

import {
  canonicalizeHarnessId,
  harnessBadgeFallbackLabel,
  harnessDisplayKind,
  resolveMessageHarnessId,
  stampUserMessageHarnessMetadata,
} from "./harness-display";

describe("harness-display", () => {
  it("resolves harness from message metadata aliases", () => {
    expect(resolveMessageHarnessId({ harness: "claude-code" })).toBe("claude-code");
    expect(resolveMessageHarnessId({ harness_id: "codebuddy" })).toBe("codebuddy");
    expect(resolveMessageHarnessId({ harnessId: "python-agent" })).toBe("python-agent");
    expect(resolveMessageHarnessId({})).toBeNull();
  });

  it("canonicalizes aliases Damon listed", () => {
    expect(canonicalizeHarnessId("hermes")).toBe("hermes-agent");
    expect(canonicalizeHarnessId("hermesagent")).toBe("hermes-agent");
    expect(canonicalizeHarnessId("pi")).toBe("pi-agent");
    expect(canonicalizeHarnessId("deepseek-harness")).toBe("deepseek");
    expect(canonicalizeHarnessId("open-claw")).toBe("openclaw");
    expect(canonicalizeHarnessId("code-buddy")).toBe("codebuddy");
  });

  it("maps known harnesses to display labels", () => {
    expect(harnessDisplayKind("python-agent")).toBe("agenticx");
    expect(harnessBadgeFallbackLabel("python-agent")).toBe("AgenticX");
    expect(harnessBadgeFallbackLabel("claude-code")).toBe("Claude Code");
    expect(harnessBadgeFallbackLabel("codebuddy")).toBe("CodeBuddy");
    expect(harnessBadgeFallbackLabel("codex")).toBe("Codex");
    expect(harnessBadgeFallbackLabel("opencode")).toBe("OpenCode");
    expect(harnessBadgeFallbackLabel("deepseek")).toBe("DeepSeek");
    expect(harnessBadgeFallbackLabel("hermes-agent")).toBe("Hermes Agent");
    expect(harnessBadgeFallbackLabel("pi-agent")).toBe("PI Agent");
    expect(harnessBadgeFallbackLabel("openclaw")).toBe("OpenClaw");
  });

  it("restamps a user row onto the harness that owns the regenerate", () => {
    const stamped = stampUserMessageHarnessMetadata(
      { harness: "codebuddy", client_turn_id: "turn-1" },
      null,
    );
    expect(stamped.client_turn_id).toBe("turn-1");
    expect(resolveMessageHarnessId(stamped)).toBe("python-agent");
    expect(stamped.harness_id).toBe("python-agent");
  });
});
