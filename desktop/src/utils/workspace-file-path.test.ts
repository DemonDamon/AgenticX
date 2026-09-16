import { describe, expect, it } from "vitest";
import {
  collapseVirtualTaskspacePrefix,
  canonicalizeArtifactPreviewPath,
  isAbsoluteFilePath,
  isAbsoluteLocalPath,
  selectOpenableArtifactPath,
} from "./workspace-file-path";

describe("isAbsoluteFilePath", () => {
  it("accepts a spaced Unicode filename inside a taskspace path", () => {
    const path =
      "/Users/damon/.agenticx/taskspaces/c0683c71-0460-48cc-b681-a3b6509ec18d/default/Hello World第三方技能点.txt";
    expect(isAbsoluteFilePath(path)).toBe(true);
    expect(isAbsoluteLocalPath(path)).toBe(true);
  });

  it("still accepts extensionless workspace roots and compact files", () => {
    expect(isAbsoluteFilePath("/tmp/notes.txt")).toBe(true);
    expect(
      isAbsoluteFilePath(
        "/Users/damon/.agenticx/taskspaces/c0683c71-0460-48cc-b681-a3b6509ec18d/default/",
      ),
    ).toBe(true);
    expect(isAbsoluteFilePath("~/Desktop/a.md")).toBe(true);
  });

  it("rejects http(s) and file URLs", () => {
    expect(isAbsoluteFilePath("https://example.com/Hello World.txt")).toBe(false);
    expect(isAbsoluteFilePath("file:///Users/damon/Hello World.txt")).toBe(false);
  });
});

describe("collapseVirtualTaskspacePrefix", () => {
  it("folds one virtual default/ layer under the workspace root", () => {
    expect(
      collapseVirtualTaskspacePrefix(
        "/Users/me/.agenticx/taskspaces/sid/default/default/mario-game/index.html",
        "/Users/me/.agenticx/taskspaces/sid/default",
        ["default"],
      ),
    ).toBe("/Users/me/.agenticx/taskspaces/sid/default/mario-game/index.html");
  });

  it("does not strip default/ when the workspace root does not match", () => {
    expect(
      collapseVirtualTaskspacePrefix(
        "/Users/me/project/default/config.json",
        "/Users/me/.agenticx/taskspaces/sid/default",
        ["default"],
      ),
    ).toBe("/Users/me/project/default/config.json");
  });
});

describe("selectOpenableArtifactPath", () => {
  const workspaceRoot = "/Users/me/.agenticx/taskspaces/sid/default";
  const stale = `${workspaceRoot}/default/mario-game/index.html`;
  const real = `${workspaceRoot}/mario-game/index.html`;
  const taskspaces = [{ id: "default", label: "默认工作区", path: workspaceRoot }];

  it("canonicalizes a doubled default/ path before treating it as primary", () => {
    expect(canonicalizeArtifactPreviewPath(stale, taskspaces)).toBe(real);
  });

  it("returns the collapsed path when it exists", () => {
    expect(selectOpenableArtifactPath(stale, (path) => path === real, taskspaces)).toBe(real);
  });

  it("does not use a missing path as primary", () => {
    expect(selectOpenableArtifactPath(stale, () => false, taskspaces)).toBeNull();
  });
});
