import { describe, expect, it } from "vitest";
import type { FileChangeHighlight } from "./session-change-highlights";
import {
  nextPreviewHighlightMode,
  resolveActiveChangeHighlight,
} from "./preview-highlight-mode";

const collected: FileChangeHighlight = {
  added: 6,
  removed: 0,
  addedLines: [1, 2, 3],
};

describe("resolveActiveChangeHighlight", () => {
  it("returns null when mode is undefined even if collected has additions", () => {
    expect(resolveActiveChangeHighlight(undefined, collected)).toBeNull();
  });

  it("returns null when mode is plain even if collected has additions", () => {
    expect(resolveActiveChangeHighlight("plain", collected)).toBeNull();
  });

  it("returns collected when mode is changes", () => {
    expect(resolveActiveChangeHighlight("changes", collected)).toEqual(collected);
  });

  it("returns null when mode is changes and collected is null", () => {
    expect(resolveActiveChangeHighlight("changes", null)).toBeNull();
  });
});

describe("nextPreviewHighlightMode", () => {
  it("returns changes when incoming is changes", () => {
    expect(nextPreviewHighlightMode("changes")).toBe("changes");
  });

  it("returns plain for missing or invalid incoming values", () => {
    expect(nextPreviewHighlightMode(undefined)).toBe("plain");
    expect(nextPreviewHighlightMode(null)).toBe("plain");
    expect(nextPreviewHighlightMode("plain")).toBe("plain");
    expect(nextPreviewHighlightMode("diff")).toBe("plain");
    expect(nextPreviewHighlightMode("")).toBe("plain");
  });
});
