import { describe, expect, it } from "vitest";
import { buildMessageScratchDraft, clipScratchTitleSnippet, hashScratchSnippet } from "./scratch-chat-open";

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
