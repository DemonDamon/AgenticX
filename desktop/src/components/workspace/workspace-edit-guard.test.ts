import { describe, expect, it } from "vitest";

import { getEditBlockReason } from "./workspace-edit-guard";
import {
  WRITE_LOCAL_TEXT_MAX_BYTES,
  applyTextEol,
  detectTextEol,
  toEditorLf,
} from "./workspace-edit-limits";

describe("getEditBlockReason", () => {
  it("allows normal textual preview", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: true,
        truncated: false,
        content: "hello\n",
        size: 6,
      }),
    ).toBeNull();
  });

  it("blocks line-focused mode", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: true,
        truncated: false,
        content: "a\nb\n",
        size: 4,
        initialLineRange: { start: 1, end: 2 },
      }),
    ).toBe("行号聚焦模式下不可编辑");
  });

  it("blocks truncated content", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: true,
        truncated: true,
        content: "partial",
        size: WRITE_LOCAL_TEXT_MAX_BYTES + 1,
      }),
    ).toContain("截断");
  });

  it("blocks content with UTF-8 replacement char", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: true,
        truncated: false,
        content: `bad\uFFFDtext`,
        size: 8,
      }),
    ).toContain("UTF-8");
  });

  it("blocks oversize files", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: true,
        truncated: false,
        content: "x",
        size: WRITE_LOCAL_TEXT_MAX_BYTES + 1,
      }),
    ).toContain("512 KB");
  });

  it("returns null for non-textual (caller hides edit entry)", () => {
    expect(
      getEditBlockReason({
        hasTextualPreview: false,
        truncated: false,
        content: "",
        size: 0,
      }),
    ).toBeNull();
  });
});

describe("EOL detect / restore", () => {
  it("detects CRLF and restores byte-identical content", () => {
    const original = "a\r\nb\r\nc\r\n";
    expect(detectTextEol(original)).toBe("crlf");
    const lf = toEditorLf(original);
    expect(lf).toBe("a\nb\nc\n");
    expect(applyTextEol(lf, "crlf")).toBe(original);
  });

  it("keeps LF files as LF", () => {
    const original = "a\nb\n";
    expect(detectTextEol(original)).toBe("lf");
    expect(applyTextEol(toEditorLf(original), "lf")).toBe(original);
  });
});
