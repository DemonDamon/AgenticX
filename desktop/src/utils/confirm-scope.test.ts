import { describe, expect, it } from "vitest";
import { buildConfirmScope, parentPathForConfirmScope } from "./confirm-scope";

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
});
