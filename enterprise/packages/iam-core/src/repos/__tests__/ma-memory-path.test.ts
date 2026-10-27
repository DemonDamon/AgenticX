import { describe, expect, it } from "vitest";

import {
  contentSha256,
  MEMORY_CONTENT_MAX_BYTES,
  normalizeMemoryPath,
  pathConflicts,
  validateMemoryContent,
} from "../ma-memory-path";

describe("normalizeMemoryPath", () => {
  it("accepts absolute NFC paths", () => {
    expect(normalizeMemoryPath("/a.md")).toBe("/a.md");
    expect(normalizeMemoryPath("/偏好/报告.md")).toBe("/偏好/报告.md");
    expect(normalizeMemoryPath("/a/b/c.txt")).toBe("/a/b/c.txt");
    expect(normalizeMemoryPath("/e\u0301.md")).toBe("/\u00e9.md");
  });

  it("rejects unsafe paths", () => {
    const rejected = [
      "a.md",
      "/",
      "/a/",
      "/a//b",
      "/a/./b",
      "/a/../b",
      "/a\u0001",
      "/a\\b",
      `/${"a".repeat(1024)}`,
      `/a/${"b".repeat(256)}`,
    ];
    for (const path of rejected) {
      expect(() => normalizeMemoryPath(path), path).toThrow(/path:/);
    }
    expect(() => normalizeMemoryPath(1)).toThrow("path: must be a string");
  });
});

describe("pathConflicts", () => {
  it("detects file and directory collisions and honors ignorePath", () => {
    expect(pathConflicts("/a/b", ["/a"])).toBe("/a");
    expect(pathConflicts("/a", ["/a/b"])).toBe("/a/b");
    expect(pathConflicts("/ab", ["/a"])).toBeNull();
    expect(pathConflicts("/notes/a.md", ["/notes/a.md"], "/notes/a.md")).toBeNull();
    expect(pathConflicts("/a/b", ["/a/b", "/c"], "/a/b")).toBeNull();
    expect(pathConflicts("/a/b", ["/a", "/a/b"], "/a/b")).toBe("/a");
  });
});

describe("validateMemoryContent", () => {
  it("accepts 100 KiB and rejects one extra byte or NUL", () => {
    const han = "汉";
    expect(Buffer.byteLength(han, "utf8")).toBe(3);
    const exact = `${han.repeat(34133)}x`;
    expect(Buffer.byteLength(exact, "utf8")).toBe(MEMORY_CONTENT_MAX_BYTES);
    expect(validateMemoryContent(exact).sizeBytes).toBe(MEMORY_CONTENT_MAX_BYTES);
    const over = `${han.repeat(34133)}xy`;
    expect(Buffer.byteLength(over, "utf8")).toBe(MEMORY_CONTENT_MAX_BYTES + 1);
    expect(() => validateMemoryContent(over)).toThrow("content: exceeds 100 KiB");
    expect(() => validateMemoryContent("a\u0000b")).toThrow("content: must not contain NUL");
    expect(() => validateMemoryContent(1)).toThrow("content: must be a string");
  });

  it("hashes empty content", () => {
    expect(contentSha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
