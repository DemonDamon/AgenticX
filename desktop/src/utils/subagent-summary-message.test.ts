import { describe, expect, it } from "vitest";
import { isSubAgentSummaryDump } from "./subagent-summary-message";

describe("isSubAgentSummaryDump", () => {
  it("matches raw sub-agent summary rows from assistant", () => {
    expect(isSubAgentSummaryDump({ role: "assistant", content: "子智能体汇总:\n[A] (ID: x) 状态=completed\nok" })).toBe(true);
  });
  it("does not match normal assistant text or other roles", () => {
    expect(isSubAgentSummaryDump({ role: "assistant", content: "以下是对比汇总" })).toBe(false);
    expect(isSubAgentSummaryDump({ role: "tool", content: "子智能体汇总: x" })).toBe(false);
  });
});
