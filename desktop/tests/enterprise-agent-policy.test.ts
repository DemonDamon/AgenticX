import { describe, expect, it } from "vitest";

import { normalizeAgentActionPolicy } from "../electron/enterprise-agent-policy";

function pattern(index: number): string {
  return `tool_${index}`;
}

describe("normalizeAgentActionPolicy", () => {
  it("falls back to the default for non-object input", () => {
    for (const raw of [undefined, null, [], "nope", 42, true]) {
      expect(normalizeAgentActionPolicy(raw)).toEqual({
        denied_tools: [],
        always_ask_tools: [],
        disable_session_allow: false,
      });
    }
  });

  it("drops items with illegal characters, blanks, and over-long text", () => {
    const tooLong = "a".repeat(129);
    expect(
      normalizeAgentActionPolicy({
        deniedTools: ["bash_exec", "bad name", "", "  ", tooLong, "mcp:send_*", 12, "git:push"],
        alwaysAskTools: ["file_write", "has space"],
      }),
    ).toEqual({
      denied_tools: ["bash_exec", "mcp:send_*", "git:push"],
      always_ask_tools: ["file_write"],
      disable_session_allow: false,
    });
  });

  it("keeps at most 100 patterns", () => {
    const deniedTools = Array.from({ length: 101 }, (_, index) => pattern(index));
    const normalized = normalizeAgentActionPolicy({ deniedTools });
    expect(normalized.denied_tools).toHaveLength(100);
    expect(normalized.denied_tools[0]).toBe("tool_0");
    expect(normalized.denied_tools[99]).toBe("tool_99");
  });

  it("trims and drops duplicate patterns while keeping the first occurrence", () => {
    expect(
      normalizeAgentActionPolicy({
        deniedTools: [" git:push ", "git:push", "bash_exec", "bash_exec"],
        alwaysAskTools: ["mcp:send_*", " mcp:send_* "],
      }),
    ).toEqual({
      denied_tools: ["git:push", "bash_exec"],
      always_ask_tools: ["mcp:send_*"],
      disable_session_allow: false,
    });
  });

  it("treats only a real boolean true as disableSessionAllow", () => {
    expect(normalizeAgentActionPolicy({ disableSessionAllow: "true" }).disable_session_allow).toBe(
      false,
    );
    expect(normalizeAgentActionPolicy({ disableSessionAllow: 1 }).disable_session_allow).toBe(false);
    expect(normalizeAgentActionPolicy({ disableSessionAllow: true }).disable_session_allow).toBe(true);
  });

  it("accepts the snake_case shape already stored on disk", () => {
    expect(
      normalizeAgentActionPolicy({
        denied_tools: ["git:push"],
        always_ask_tools: ["bash_exec"],
        disable_session_allow: true,
      }),
    ).toEqual({
      denied_tools: ["git:push"],
      always_ask_tools: ["bash_exec"],
      disable_session_allow: true,
    });
  });
});
