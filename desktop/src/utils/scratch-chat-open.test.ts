import { describe, expect, it } from "vitest";
import {
  buildMessageScratchDraft,
  buildPathScratchDraft,
  buildPreviewScratchDraft,
  buildBlankScratchDraft,
  buildQuotedScratchDraft,
  clipScratchTitleSnippet,
  fileLabelFromPath,
  hashScratchSnippet,
} from "./scratch-chat-open";

describe("clipScratchTitleSnippet", () => {
  it("collapses whitespace and clips long text", () => {
    expect(clipScratchTitleSnippet("  hello   world  ")).toBe("hello world");
    expect(clipScratchTitleSnippet("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmnopqrstuvwx…");
    expect(clipScratchTitleSnippet("   ")).toBe("");
  });
});

describe("buildMessageScratchDraft", () => {
  it("uses the whole message when there is no selection", () => {
    const draft = buildMessageScratchDraft({
      messageId: "m1",
      quotedContent: "整条回复",
      title: "关于 整条回复",
    });
    expect(draft.sourceKind).toBe("message");
    expect(draft.sourceKey).toBe("message:m1");
    expect(draft.quotedContent).toBe("整条回复");
  });

  it("uses the selection and a stable hash key", () => {
    const a = buildMessageScratchDraft({
      messageId: "m1",
      quotedContent: "整条回复",
      selectedText: "  划词片段  ",
      title: "关于 划词片段",
    });
    const b = buildMessageScratchDraft({
      messageId: "m1",
      quotedContent: "整条回复",
      selectedText: "划词片段",
      title: "关于 划词片段",
    });
    expect(a.sourceKind).toBe("selection");
    expect(a.quotedContent).toBe("划词片段");
    expect(a.sourceKey).toBe(`selection:m1:${hashScratchSnippet("划词片段")}`);
    expect(b.sourceKey).toBe(a.sourceKey);
  });

  it("gives different selections different keys", () => {
    const a = buildMessageScratchDraft({
      messageId: "m1",
      quotedContent: "整条",
      selectedText: "甲",
      title: "关于 甲",
    });
    const b = buildMessageScratchDraft({
      messageId: "m1",
      quotedContent: "整条",
      selectedText: "乙",
      title: "关于 乙",
    });
    expect(a.sourceKey).not.toBe(b.sourceKey);
  });
});

describe("fileLabelFromPath", () => {
  it("takes the last path segment", () => {
    expect(fileLabelFromPath("/tmp/report.md")).toBe("report.md");
    expect(fileLabelFromPath("C:\\docs\\a.ts")).toBe("a.ts");
    expect(fileLabelFromPath("   ")).toBe("file");
  });
});

describe("buildPathScratchDraft", () => {
  it("attaches the absolute path and a stable kind key", () => {
    const draft = buildPathScratchDraft({
      kind: "artifact",
      path: "/tmp/out.pdf",
      title: "关于 out.pdf",
    });
    expect(draft.sourceKind).toBe("artifact");
    expect(draft.sourceKey).toBe("artifact:/tmp/out.pdf");
    expect(draft.contextFiles).toEqual([{ path: "/tmp/out.pdf", sourcePath: "/tmp/out.pdf" }]);
    expect(draft.quotedContent).toBeUndefined();
  });
});

describe("buildQuotedScratchDraft", () => {
  it("hashes terminal and browser selections", () => {
    const a = buildQuotedScratchDraft({
      kind: "terminal",
      rawKey: "selection",
      quotedContent: "ls -la",
      title: "关于 ls -la",
    });
    const b = buildQuotedScratchDraft({
      kind: "browser",
      rawKey: "https://example.com",
      quotedContent: "ls -la",
      title: "关于 ls -la",
    });
    expect(a.sourceKey).toBe(`terminal:selection:${hashScratchSnippet("ls -la")}`);
    expect(b.sourceKey).toBe(`browser:https://example.com:${hashScratchSnippet("ls -la")}`);
    expect(a.quotedContent).toBe("ls -la");
  });

  it("keeps todo and reference keys stable without a snippet hash", () => {
    const draft = buildQuotedScratchDraft({
      kind: "todo",
      rawKey: "0:写报告",
      quotedContent: "写报告",
      title: "关于 写报告",
    });
    expect(draft.sourceKey).toBe("todo:0:写报告");
    expect(draft.sourceKind).toBe("todo");
  });
});

describe("buildPreviewScratchDraft", () => {
  it("uses a hashed file key when a snippet is present", () => {
    const draft = buildPreviewScratchDraft({
      absolutePath: "/tmp/a.ts",
      snippet: "const x = 1",
      title: "关于 const x = 1",
    });
    expect(draft.sourceKind).toBe("file");
    expect(draft.sourceKey).toBe(`file:/tmp/a.ts:${hashScratchSnippet("const x = 1")}`);
    expect(draft.quotedContent).toBe("const x = 1");
    expect(draft.contextFiles).toEqual([{ path: "/tmp/a.ts", sourcePath: "/tmp/a.ts" }]);
  });

  it("falls back to a path-only file draft without a snippet", () => {
    const draft = buildPreviewScratchDraft({
      absolutePath: "/tmp/a.ts",
      title: "关于 a.ts",
    });
    expect(draft.sourceKey).toBe("file:/tmp/a.ts");
    expect(draft.quotedContent).toBeUndefined();
    expect(draft.contextFiles).toEqual([{ path: "/tmp/a.ts", sourcePath: "/tmp/a.ts" }]);
  });
});

describe("buildBlankScratchDraft", () => {
  it("creates a unique selection scratch without quoted content", () => {
    const a = buildBlankScratchDraft("临时对话");
    const b = buildBlankScratchDraft("临时对话");
    expect(a.sourceKind).toBe("selection");
    expect(a.sourceKey.startsWith("selection:blank:")).toBe(true);
    expect(a.sourceKey).not.toBe(b.sourceKey);
    expect(a.quotedContent).toBeUndefined();
  });
});
