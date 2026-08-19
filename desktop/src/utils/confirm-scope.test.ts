import { describe, expect, it } from "vitest";
import {
  buildConfirmScope,
  isProtectedConfirmContext,
  normalizeConfirmRisk,
  parentPathForConfirmScope,
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
    expect(shouldAutoApproveConfirm("semi-auto", true, { risk: "destructive" })).toBe(false);
    expect(shouldAutoApproveConfirm("auto", true)).toBe(false);

    expect(shouldAutoApproveConfirm("auto", false, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("semi-auto", true, { risk: "low" })).toBe(true);
    expect(shouldAutoApproveConfirm("manual", false, { risk: "low" })).toBe(false);
  });
});
