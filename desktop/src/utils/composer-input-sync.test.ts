import { describe, expect, it } from "vitest";
import {
  AT_MENTION_SEARCH_DEBOUNCE_MS,
  domTextLooksNonEmpty,
  isComposerNonEmpty,
  matchTrailingAtMention,
  nextComposerAtMentionState,
  shouldCommitComposerHasText,
} from "./composer-input-sync";

describe("isComposerNonEmpty", () => {
  it("treats whitespace-only as empty", () => {
    expect(isComposerNonEmpty("")).toBe(false);
    expect(isComposerNonEmpty("   \n")).toBe(false);
  });

  it("treats any visible text as non-empty", () => {
    expect(isComposerNonEmpty("h")).toBe(true);
    expect(isComposerNonEmpty("  你好")).toBe(true);
  });
});

describe("shouldCommitComposerHasText", () => {
  it("does not commit while typing inside a non-empty composer", () => {
    expect(shouldCommitComposerHasText(true, "he")).toBe(false);
    expect(shouldCommitComposerHasText(true, "hello world")).toBe(false);
  });

  it("commits only when crossing empty ↔ non-empty", () => {
    expect(shouldCommitComposerHasText(false, "h")).toBe(true);
    expect(shouldCommitComposerHasText(true, "")).toBe(true);
    expect(shouldCommitComposerHasText(true, "   ")).toBe(true);
    expect(shouldCommitComposerHasText(false, "")).toBe(false);
  });
});

describe("matchTrailingAtMention", () => {
  it("returns null for ordinary typing", () => {
    expect(matchTrailingAtMention("hello")).toBeNull();
    expect(matchTrailingAtMention("email@x.com more")).toBeNull();
  });

  it("captures a trailing @ query", () => {
    expect(matchTrailingAtMention("@")).toBe("");
    expect(matchTrailingAtMention("hi @fi")).toBe("fi");
    expect(matchTrailingAtMention("\n@readme")).toBe("readme");
  });
});

describe("nextComposerAtMentionState", () => {
  it("closes the picker when the caret is not in an @ token", () => {
    expect(nextComposerAtMentionState("hello")).toEqual({
      open: false,
      query: "",
      shouldSearch: false,
    });
  });

  it("opens the picker and asks for a search while composing an @ mention", () => {
    expect(nextComposerAtMentionState("请看 @src/")).toEqual({
      open: true,
      query: "src/",
      shouldSearch: true,
    });
  });
});

describe("domTextLooksNonEmpty", () => {
  it("hides the placeholder as soon as IME inserts any visible glyph", () => {
    expect(domTextLooksNonEmpty("n")).toBe(true);
    expect(domTextLooksNonEmpty("\u00a0")).toBe(false);
    expect(domTextLooksNonEmpty("")).toBe(false);
    expect(domTextLooksNonEmpty(null)).toBe(false);
  });
});

describe("AT_MENTION_SEARCH_DEBOUNCE_MS", () => {
  it("stays a short keystroke debounce, not a noticeable pause", () => {
    expect(AT_MENTION_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(50);
    expect(AT_MENTION_SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(150);
  });
});
