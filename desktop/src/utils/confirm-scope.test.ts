import { describe, expect, it } from "vitest";
import {
  NEVER_REUSABLE_CATEGORIES,
  buildConfirmApprovalKey,
  buildConfirmScope,
  hasNeverReusableCategory,
  isProtectedConfirmContext,
  normalizeConfirmRisk,
  parentPathForConfirmScope,
  protectedConfirmReason,
  shouldAutoApproveConfirm,
} from "./confirm-scope";

describe("never-reusable categories", () => {
  it("matches the backend never-auto-approved set exactly", () => {
    expect([...NEVER_REUSABLE_CATEGORIES].sort()).toEqual([
      "destructive_filesystem",
      "external_publish",
      "host_full_access",
      "system_disruption",
    ].sort());
  });

  it("detects never-reusable codes on confirm context", () => {
    expect(
      hasNeverReusableCategory({
        risk_categories: [{ code: "destructive_filesystem" }],
      }),
    ).toBe(true);
    expect(hasNeverReusableCategory({ risk_categories: [{ code: "arbitrary_code_execution" }] })).toBe(
      false,
    );
  });
});

describe("confirmation scope", () => {
  it("groups Windows file changes by their parent directory", () => {
    const path = "C:\\Users\\demo\\workspace\\report.md";
    expect(parentPathForConfirmScope(path)).toBe("C:\\Users\\demo\\workspace");
    expect(buildConfirmScope("write?", { tool: "file_write", path })).toBe(
      "file_write:C:\\Users\\demo\\workspace",
    );
  });

  it("groups POSIX file edits by their parent directory", () => {
    expect(
      buildConfirmScope("edit?", { tool: "file_edit", path: "/tmp/project/report.md" }),
    ).toBe("file_edit:/tmp/project");
  });

  it("keeps command and unknown-tool scopes narrow", () => {
    expect(buildConfirmScope("run?", { tool: "bash_exec", command: "git status" })).toBe(
      "bash_exec:git",
    );
    expect(buildConfirmScope("run?", { tool: "custom_tool" })).toBe("tool:custom_tool");
  });

  it("only treats an explicit low-risk marker as auto-approvable", () => {
    expect(normalizeConfirmRisk({ risk: " low " })).toBe("low");
    expect(isProtectedConfirmContext({ risk: "low" })).toBe(false);

    for (const risk of ["high", "destructive", "computer_use", "policy", "unknown"]) {
      expect(isProtectedConfirmContext({ risk })).toBe(true);
    }
    expect(isProtectedConfirmContext({})).toBe(true);
    expect(isProtectedConfirmContext()).toBe(true);
  });

  it("does not let on-demand mode bypass protected risk", () => {
    expect(shouldAutoApproveConfirm("allowlist", true, { risk: "destructive" })).toBe(false);
    expect(shouldAutoApproveConfirm("allowlist", true, { risk: "high" })).toBe(false);
    expect(shouldAutoApproveConfirm("ask", false, { risk: "low" })).toBe(false);
  });

  it("lets on-demand mode skip conventional commands without asking first", () => {
    expect(shouldAutoApproveConfirm("allowlist", false, { risk: "non_whitelisted" })).toBe(true);
    expect(shouldAutoApproveConfirm("allowlist", false, { risk: "low" })).toBe(true);
  });

  it("lets allow-all skip every confirm, including high risk", () => {
    expect(shouldAutoApproveConfirm("auto", false, { risk: "high" })).toBe(true);
    expect(shouldAutoApproveConfirm("auto", false, { risk: "non_whitelisted" })).toBe(true);
    expect(shouldAutoApproveConfirm("auto", false)).toBe(true);
    expect(shouldAutoApproveConfirm("auto", false, { risk: "low" })).toBe(true);
  });

  it("follows the run mode in force right now, so switching back to ask re-asks everything", () => {
    expect(shouldAutoApproveConfirm("ask", true, { risk: "non_whitelisted" })).toBe(false);
    expect(shouldAutoApproveConfirm("ask", true, { risk: "low" })).toBe(false);
  });

  it("每个受保护请求都说得出为什么，包括没标 risk 的", () => {
    expect(
      protectedConfirmReason({ risk: "high", protected_reason: "后端说的理由" }),
    ).toBe("后端说的理由");

    expect(protectedConfirmReason({ risk: "non_whitelisted" })).toContain("白名单");
    expect(protectedConfirmReason({ risk: "destructive" })).toContain("删除或覆盖");
    expect(protectedConfirmReason({ risk: "computer_use" })).toContain("本机桌面");

    expect(protectedConfirmReason({})).not.toBe("");
    expect(protectedConfirmReason({ risk: "某个将来才有的档" })).not.toBe("");

    expect(protectedConfirmReason({ risk: "low" })).toBe("");
  });
});

describe("confirm approval keys", () => {
  it("reuses the same key across turns inside one session and workspace", () => {
    const first = buildConfirmApprovalKey("session-1", "/tmp/ws-a", "bash_exec:rm");
    const second = buildConfirmApprovalKey("session-1", "/tmp/ws-a", "bash_exec:rm");
    expect(first).toBe(second);
    const allowed = new Set([first]);
    expect(allowed.has(second)).toBe(true);
  });

  it("does not reuse an approval in another session", () => {
    const previous = buildConfirmApprovalKey("session-1", "/tmp/ws-a", "bash_exec:rm");
    const next = buildConfirmApprovalKey("session-2", "/tmp/ws-a", "bash_exec:rm");
    expect(previous).not.toBe(next);
  });

  it("does not reuse an approval after the workspace changes", () => {
    const testing = buildConfirmApprovalKey("session-1", "/tmp/ws-a", "bash_exec:rm");
    const production = buildConfirmApprovalKey("session-1", "/tmp/ws-b", "bash_exec:rm");
    expect(testing).not.toBe(production);
  });
});
