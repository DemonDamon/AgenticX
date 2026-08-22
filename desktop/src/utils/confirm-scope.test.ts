import { describe, expect, it } from "vitest";
import {
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

    for (const risk of ["high", "destructive", "permission_escalation", "policy", "unknown"]) {
      expect(isProtectedConfirmContext({ risk })).toBe(true);
    }
    expect(isProtectedConfirmContext({})).toBe(true);
    expect(isProtectedConfirmContext()).toBe(true);
  });

  it("does not let global auto or an existing scope bypass protected risk", () => {
    expect(shouldAutoApproveConfirm("auto", false, { risk: "high" })).toBe(false);
    expect(shouldAutoApproveConfirm("semi-auto", true, { risk: "destructive" })).toBe(false);
    expect(shouldAutoApproveConfirm("auto", true)).toBe(false);

    expect(shouldAutoApproveConfirm("auto", false, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("semi-auto", true, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("manual", false, { risk: "low" })).toBe(false);
  });

  it("每个受保护请求都说得出为什么，包括没标 risk 的", () => {
    // 后端给了理由就用后端的：理由的唯一出处在那边
    expect(
      protectedConfirmReason({ risk: "high", protected_reason: "后端说的理由" }),
    ).toBe("后端说的理由");

    // 拿不到才回退本地镜像
    expect(protectedConfirmReason({ risk: "non_whitelisted" })).toContain("白名单");
    expect(protectedConfirmReason({ risk: "destructive" })).toContain("删除或覆盖");
    expect(protectedConfirmReason({ risk: "permission_escalation" })).toContain("工作区写入隔离");

    // fail-closed 的那一档也必须有话说 —— 弹了框却不给理由，用户只会当成故障
    expect(protectedConfirmReason({})).not.toBe("");
    expect(protectedConfirmReason({ risk: "某个将来才有的档" })).not.toBe("");

    // 低风险不该有理由：它根本不会弹框
    expect(protectedConfirmReason({ risk: "low" })).toBe("");
  });
});
