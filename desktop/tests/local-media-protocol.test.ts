import { describe, expect, it } from "vitest";
import {
  LOCAL_MEDIA_SCHEME,
  buildLocalMediaUrl,
  parseLocalMediaPath,
  resolveAllowedLocalVideoFile,
} from "../electron/local-media-protocol";

describe("local media URL", () => {
  it("round-trips an absolute path including spaces", () => {
    const abs = "/Users/damon/Desktop/产品介绍 终稿.mp4";
    const url = buildLocalMediaUrl(abs);
    expect(url.startsWith(`${LOCAL_MEDIA_SCHEME}://`)).toBe(true);
    expect(parseLocalMediaPath(url)).toBe(abs);
  });

  it("rejects a non-media scheme", () => {
    expect(parseLocalMediaPath("https://example.com/?p=/tmp/a.mp4")).toBeNull();
  });
});

describe("resolveAllowedLocalVideoFile", () => {
  it("allows an existing mp4 after normalize", () => {
    expect(
      resolveAllowedLocalVideoFile("/tmp/clip.mp4", {
        normalizePath: (raw) => raw,
        isFile: () => true,
      }),
    ).toBe("/tmp/clip.mp4");
  });

  it("rejects a missing file or a non-video suffix", () => {
    expect(
      resolveAllowedLocalVideoFile("/tmp/clip.mp4", {
        normalizePath: (raw) => raw,
        isFile: () => false,
      }),
    ).toBeNull();
    expect(
      resolveAllowedLocalVideoFile("/tmp/notes.txt", {
        normalizePath: (raw) => raw,
        isFile: () => true,
      }),
    ).toBeNull();
  });
});
