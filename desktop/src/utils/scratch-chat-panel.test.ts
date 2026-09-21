import { describe, expect, it } from "vitest";
import type { ScratchChat } from "./scratch-chat";
import {
  resolveActiveScratchId,
  resolveScratchFocusId,
  shouldRenderDockedScratchBody,
} from "./scratch-chat-panel";

function chat(partial: Partial<ScratchChat> & Pick<ScratchChat, "id">): ScratchChat {
  return {
    title: partial.title ?? partial.id,
    sourceKind: partial.sourceKind ?? "message",
    sourceKey: partial.sourceKey ?? `message:${partial.id}`,
    sessionId: partial.sessionId ?? "",
    messages: partial.messages ?? [],
    floating: partial.floating ?? false,
    quotedContent: partial.quotedContent,
    contextFiles: partial.contextFiles,
    ...partial,
  };
}

describe("resolveActiveScratchId", () => {
  it("keeps the current id when it still exists", () => {
    const chats = [chat({ id: "a" }), chat({ id: "b" })];
    expect(resolveActiveScratchId(chats, "b")).toBe("b");
  });

  it("falls back to the first chat when current is gone", () => {
    const chats = [chat({ id: "a" }), chat({ id: "c" })];
    expect(resolveActiveScratchId(chats, "b")).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(resolveActiveScratchId([], "a")).toBeNull();
  });
});

describe("resolveScratchFocusId", () => {
  it("prefers a requested id that exists", () => {
    const chats = [chat({ id: "a" }), chat({ id: "b" })];
    expect(resolveScratchFocusId(chats, "b", "a")).toBe("b");
  });

  it("falls back when the requested id is missing", () => {
    const chats = [chat({ id: "a" }), chat({ id: "b" })];
    expect(resolveScratchFocusId(chats, "gone", "b")).toBe("b");
    expect(resolveScratchFocusId(chats, "", null)).toBe("a");
  });
});

describe("shouldRenderDockedScratchBody", () => {
  it("is false for floating or missing chats", () => {
    expect(shouldRenderDockedScratchBody(undefined)).toBe(false);
    expect(shouldRenderDockedScratchBody(chat({ id: "a", floating: true }))).toBe(false);
    expect(shouldRenderDockedScratchBody(chat({ id: "a", floating: false }))).toBe(true);
  });
});
