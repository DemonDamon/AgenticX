import { describe, expect, it } from "vitest";
import { isVideoFile } from "./video-file";

function mockFile(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

describe("isVideoFile", () => {
  it("matches by extension", () => {
    expect(isVideoFile(mockFile("foo.mp4"))).toBe(true);
    expect(isVideoFile(mockFile("bar.MOV"))).toBe(true);
    expect(isVideoFile(mockFile("baz.webm"))).toBe(true);
  });

  it("matches by mime type", () => {
    expect(isVideoFile(mockFile("unknown.bin", "video/mp4"))).toBe(true);
  });

  it("rejects non-video files", () => {
    expect(isVideoFile(mockFile("a.png"))).toBe(false);
    expect(isVideoFile(mockFile("b.txt"))).toBe(false);
    expect(isVideoFile(mockFile("c.pdf"))).toBe(false);
  });
});
