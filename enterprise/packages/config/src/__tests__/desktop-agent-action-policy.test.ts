import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_AGENT_ACTION_POLICY,
  normalizeDesktopAgentActionPolicy,
} from "../desktop-agent-action-policy";

function pattern(index: number): string {
  return `tool_${index}`;
}

describe("normalizeDesktopAgentActionPolicy", () => {
  it("falls back to the default for non-object input", () => {
    for (const raw of [undefined, null, [], "nope", 42, true]) {
      expect(normalizeDesktopAgentActionPolicy(raw)).toEqual(DEFAULT_DESKTOP_AGENT_ACTION_POLICY);
    }
  });

  it("drops items with illegal characters, blanks, and over-long text", () => {
    const tooLong = "a".repeat(129);
    expect(
      normalizeDesktopAgentActionPolicy({
        deniedTools: ["bash_exec", "bad name", "", "  ", tooLong, "mcp:send_*", 12, "git:push"],
        alwaysAskTools: ["file_write", "has space"],
      }),
    ).toEqual({
      deniedTools: ["bash_exec", "mcp:send_*", "git:push"],
      alwaysAskTools: ["file_write"],
      disableSessionAllow: false,
    });
  });

  it("keeps at most 100 patterns", () => {
    const deniedTools = Array.from({ length: 101 }, (_, index) => pattern(index));
    const normalized = normalizeDesktopAgentActionPolicy({ deniedTools });
    expect(normalized.deniedTools).toHaveLength(100);
    expect(normalized.deniedTools[0]).toBe("tool_0");
    expect(normalized.deniedTools[99]).toBe("tool_99");
  });

  it("trims and drops duplicate patterns while keeping the first occurrence", () => {
    expect(
      normalizeDesktopAgentActionPolicy({
        deniedTools: [" git:push ", "git:push", "bash_exec", "bash_exec"],
        alwaysAskTools: ["mcp:send_*", " mcp:send_* "],
      }),
    ).toEqual({
      deniedTools: ["git:push", "bash_exec"],
      alwaysAskTools: ["mcp:send_*"],
      disableSessionAllow: false,
    });
  });

  it("treats only a real boolean true as disableSessionAllow", () => {
    expect(normalizeDesktopAgentActionPolicy({ disableSessionAllow: "true" }).disableSessionAllow).toBe(
      false,
    );
    expect(normalizeDesktopAgentActionPolicy({ disableSessionAllow: 1 }).disableSessionAllow).toBe(false);
    expect(normalizeDesktopAgentActionPolicy({ disableSessionAllow: true }).disableSessionAllow).toBe(true);
  });
});
