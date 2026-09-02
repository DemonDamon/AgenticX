import { describe, expect, it } from "vitest";
import { isAbsoluteFilePath, isAbsoluteLocalPath } from "./workspace-file-path";

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
