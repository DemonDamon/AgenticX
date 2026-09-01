import { describe, expect, it } from "vitest";
import {
  isLiveReloadablePreview,
  previewKnownMtimeMs,
  shouldReloadPreviewFromStat,
  textualPreviewUnchanged,
} from "./preview-live-reload";
import type { WorkspacePreview } from "../workspace/workspace-preview-types";

function mdPreview(overrides: Partial<Extract<WorkspacePreview, { kind: "markdown" }>> = {}): WorkspacePreview {
  return {
    kind: "markdown",
    path: "note.md",
    absolutePath: "/tmp/note.md",
    content: "# hi",
    size: 4,
    truncated: false,
    mimeType: "text/markdown",
    mtimeMs: 1000,
    ...overrides,
  };
}

describe("shouldReloadPreviewFromStat", () => {
  it("skips when the tab is dirty so live agent writes do not clobber edits", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: true,
        loading: false,
        knownMtimeMs: 1000,
        diskMtimeMs: 2000,
      }),
    ).toBe(false);
  });

  it("skips while the first load is still in flight", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: true,
        knownMtimeMs: 1000,
        diskMtimeMs: 2000,
      }),
    ).toBe(false);
  });

  it("skips when disk mtime is missing", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: false,
        knownMtimeMs: 1000,
      }),
    ).toBe(false);
  });

  it("skips when disk mtime matches the opened snapshot", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: false,
        knownMtimeMs: 1000,
        diskMtimeMs: 1000,
      }),
    ).toBe(false);
  });

  it("skips when disk mtime is within 1ms of the snapshot (fs precision)", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: false,
        knownMtimeMs: 1000,
        diskMtimeMs: 1001,
      }),
    ).toBe(false);
  });

  it("reloads when the file mtime moved after an external / agent write", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: false,
        knownMtimeMs: 1000,
        diskMtimeMs: 2500,
      }),
    ).toBe(true);
  });

  it("reloads when the opened snapshot has no mtime but disk reports one", () => {
    expect(
      shouldReloadPreviewFromStat({
        dirty: false,
        loading: false,
        diskMtimeMs: 2500,
      }),
    ).toBe(true);
  });
});

describe("isLiveReloadablePreview", () => {
  it("only live-reloads textual documents", () => {
    expect(isLiveReloadablePreview(mdPreview())).toBe(true);
    expect(
      isLiveReloadablePreview({
        kind: "image",
        path: "a.png",
        absolutePath: "/tmp/a.png",
        size: 10,
        mimeType: "image/png",
      }),
    ).toBe(false);
    expect(isLiveReloadablePreview(null)).toBe(false);
  });
});

describe("previewKnownMtimeMs", () => {
  it("reads mtime from textual previews only", () => {
    expect(previewKnownMtimeMs(mdPreview())).toBe(1000);
    expect(previewKnownMtimeMs(mdPreview({ mtimeMs: undefined }))).toBeUndefined();
    expect(
      previewKnownMtimeMs({
        kind: "image",
        path: "a.png",
        absolutePath: "/tmp/a.png",
        size: 10,
        mimeType: "image/png",
      }),
    ).toBeUndefined();
    expect(previewKnownMtimeMs(null)).toBeUndefined();
  });
});

describe("textualPreviewUnchanged", () => {
  it("treats same path/content/mtime as unchanged", () => {
    const a = mdPreview();
    const b = mdPreview();
    expect(textualPreviewUnchanged(a, b)).toBe(true);
  });

  it("detects content or mtime drift", () => {
    expect(textualPreviewUnchanged(mdPreview(), mdPreview({ content: "# next" }))).toBe(false);
    expect(textualPreviewUnchanged(mdPreview(), mdPreview({ mtimeMs: 2000 }))).toBe(false);
    expect(textualPreviewUnchanged(null, mdPreview())).toBe(false);
  });
});
