import { describe, expect, it } from "vitest";
import { buildContextFileKeyFromAttachment } from "./reference-attachment";
import { isLikelyTextFile } from "./text-attachment";

describe("isLikelyTextFile", () => {
  it("accepts HTML by extension even with empty MIME", () => {
    expect(isLikelyTextFile({ name: "断舍离待办清单.html", type: "" })).toBe(true);
    expect(isLikelyTextFile({ name: "page.htm", type: "" })).toBe(true);
  });

  it("accepts text/* MIME and web companion extensions", () => {
    expect(isLikelyTextFile({ name: "x.bin", type: "text/html" })).toBe(true);
    expect(isLikelyTextFile({ name: "app.css", type: "" })).toBe(true);
    expect(isLikelyTextFile({ name: "icon.svg", type: "" })).toBe(true);
    expect(isLikelyTextFile({ name: "notes.md", type: "" })).toBe(true);
  });

  it("rejects unknown binary without text MIME", () => {
    expect(isLikelyTextFile({ name: "photo.png", type: "image/png" })).toBe(false);
    expect(isLikelyTextFile({ name: "deck.pptx", type: "" })).toBe(false);
  });
});

describe("buildContextFileKeyFromAttachment + sourcePath", () => {
  it("prefers absolute sourcePath over bare name for HTML", () => {
    const key = buildContextFileKeyFromAttachment({
      name: "断舍离待办清单.html",
      sourcePath: "/Users/damon/断舍离待办清单.html",
    });
    expect(key).toBe("/Users/damon/断舍离待办清单.html");
  });

  it("falls back to bare name when sourcePath missing", () => {
    const key = buildContextFileKeyFromAttachment({
      name: "断舍离待办清单.html",
      sourcePath: "",
    });
    expect(key).toBe("断舍离待办清单.html");
  });
});
