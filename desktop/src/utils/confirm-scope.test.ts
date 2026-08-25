import { describe, expect, it } from "vitest";
import {
  buildConfirmApprovalKey,
  buildConfirmScope,
  isProtectedConfirmContext,
  normalizeConfirmRisk,
  parentPathForConfirmScope,
  protectedConfirmReason,
  shouldAutoApproveConfirm,
} from "./confirm-scope";

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

  it("does not let global auto or an existing scope bypass protected risk", () => {
    expect(shouldAutoApproveConfirm("auto", false, { risk: "high" })).toBe(false);
    expect(shouldAutoApproveConfirm("allowlist", true, { risk: "destructive" })).toBe(false);
    expect(shouldAutoApproveConfirm("auto", true)).toBe(false);

    expect(shouldAutoApproveConfirm("auto", false, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("allowlist", true, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("ask", false, { risk: "low" })).toBe(false);
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
  it("reuses the same key inside one run and workspace", () => {
    const first = buildConfirmApprovalKey("run-1", "/tmp/ws-a", "bash_exec:rm");
    const second = buildConfirmApprovalKey("run-1", "/tmp/ws-a", "bash_exec:rm");
    expect(first).toBe(second);
    const allowed = new Set([first]);
    expect(allowed.has(second)).toBe(true);
  });

  it("does not reuse an approval after a new run starts", () => {
    const previous = buildConfirmApprovalKey("run-1", "/tmp/ws-a", "bash_exec:rm");
    const next = buildConfirmApprovalKey("run-2", "/tmp/ws-a", "bash_exec:rm");
    expect(previous).not.toBe(next);
  });

  it("does not reuse an approval after the workspace changes", () => {
    const testing = buildConfirmApprovalKey("run-1", "/tmp/ws-a", "bash_exec:rm");
    const production = buildConfirmApprovalKey("run-1", "/tmp/ws-b", "bash_exec:rm");
    expect(testing).not.toBe(production);
  });
});
