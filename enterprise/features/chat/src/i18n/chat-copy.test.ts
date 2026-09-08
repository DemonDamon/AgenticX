import { describe, expect, it } from "vitest";
import { chatCopyKeys, getChatCopy } from "./chat-copy";

const CJK = /[\u4e00-\u9fff]/;

describe("getChatCopy", () => {
  it("keeps zh/en key sets identical", () => {
    expect(chatCopyKeys("en")).toEqual(chatCopyKeys("zh"));
  });

  it("returns English chrome without CJK", () => {
    const copy = getChatCopy("en");
    expect(copy.messageActions.copy).toBe("Copy");
    expect(copy.interaction.auto).toBe("Auto");
    expect(copy.segments.searchWeb).toBe("Search web");
    expect(copy.segments.doneSuffix).toBe("Done");
    expect(copy.delivery.previewFile).toBe("Preview file");
    expect(copy.delivery.allFiles).toBe("All files");
    expect(copy.delivery.allFilesHint).toBe("Preview or download files");
    expect(copy.delivery.loading).toBe("Loading…");
    expect(copy.delivery.citations).toBe("Citations");
    expect(copy.delivery.previewFile).not.toMatch(CJK);
    expect(copy.messageActions.copy).not.toMatch(CJK);
    expect(copy.clarify.intro).not.toMatch(CJK);
  });

  it("defaults unknown locales to zh", () => {
    expect(getChatCopy(undefined).messageActions.copy).toBe("复制");
    expect(getChatCopy("fr").interaction.auto).toBe("自动");
  });
});
