import { describe, expect, it } from "vitest";
import {
  closeScratchChatList,
  collectScratchSessionIds,
  excludeScratchSessionsFromHistory,
  normalizePersistedScratchChats,
  scratchSourceKey,
  setScratchFloating,
  shouldConfirmCloseScratch,
  upsertScratchChatList,
  type ScratchChat,
} from "./scratch-chat";

function chat(partial: Partial<ScratchChat> & Pick<ScratchChat, "id" | "sourceKey">): ScratchChat {
  return {
    title: partial.title ?? "关于这段回复",
    sourceKind: partial.sourceKind ?? "message",
    quotedContent: partial.quotedContent,
    contextFiles: partial.contextFiles,
    sessionId: partial.sessionId ?? "",
    messages: partial.messages ?? [],
    floating: partial.floating ?? false,
    ...partial,
  };
}

describe("scratch-chat helpers", () => {
  it("builds a stable source key", () => {
    expect(scratchSourceKey("message", "m1")).toBe("message:m1");
    expect(scratchSourceKey("selection", "m1", "  hello  ")).toBe("selection:m1:hello");
  });

  it("reuses the same sourceKey on upsert", () => {
    const first = upsertScratchChatList(
      [],
      { title: "关于这段回复", sourceKind: "message", sourceKey: "message:m1", quotedContent: "a" },
      "c1"
    );
    expect(first.reused).toBe(false);
    expect(first.chats).toHaveLength(1);

    const second = upsertScratchChatList(
      first.chats,
      { title: "关于这段回复", sourceKind: "message", sourceKey: "message:m1", quotedContent: "b" },
      "c2"
    );
    expect(second.reused).toBe(true);
    expect(second.chats).toHaveLength(1);
    expect(second.chat.id).toBe("c1");
    expect(second.chat.quotedContent).toBe("b");
  });

  it("floats only one scratch chat at a time", () => {
    const chats: ScratchChat[] = [
      chat({ id: "a", sourceKey: "message:1", floating: true }),
      chat({ id: "b", sourceKey: "message:2" }),
    ];
    const floated = setScratchFloating(chats, "b", true);
    expect(floated.map((item) => item.floating)).toEqual([false, true]);
    const docked = setScratchFloating(floated, "b", false);
    expect(docked.every((item) => item.floating === false)).toBe(true);
  });

  it("asks to confirm close only when the scratch has content", () => {
    expect(shouldConfirmCloseScratch({ sessionId: "", messages: [] })).toBe(false);
    expect(shouldConfirmCloseScratch({ sessionId: "s1", messages: [] })).toBe(true);
    expect(
      shouldConfirmCloseScratch({
        sessionId: "",
        messages: [{ id: "m", role: "user", content: "hi" }],
      })
    ).toBe(true);
  });

  it("hides scratch sessions from history rows", () => {
    const rows = [
      { session_id: "main" },
      { session_id: "scratch-1" },
      { session_id: "other" },
    ];
    const ids = collectScratchSessionIds([
      { scratchChats: [chat({ id: "c", sourceKey: "message:1", sessionId: "scratch-1" })] },
      { scratchChats: [] },
    ]);
    expect([...ids]).toEqual(["scratch-1"]);
    expect(excludeScratchSessionsFromHistory(rows, ids).map((row) => row.session_id)).toEqual([
      "main",
      "other",
    ]);
  });

  it("normalizes persisted scratch chats and forces floating off", () => {
    const chats = normalizePersistedScratchChats([
      {
        id: "c1",
        title: "关于 report.md",
        sourceKind: "file",
        sourceKey: "file:/tmp/report.md",
        sessionId: "sid-1",
        floating: true,
        messages: [{ id: "m", role: "user", content: "q" }],
        contextFiles: [{ path: "/tmp/report.md", sourcePath: "/tmp/report.md" }],
      },
      { id: "", title: "bad", sourceKind: "file", sourceKey: "file:x" },
      { title: "no-id", sourceKind: "message", sourceKey: "message:x" },
      { id: "c2", title: "x", sourceKind: "nope", sourceKey: "x" },
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).toBe("c1");
    expect(chats[0]?.floating).toBe(false);
    expect(chats[0]?.sessionId).toBe("sid-1");
    expect(chats[0]?.messages).toHaveLength(1);
    expect(closeScratchChatList(chats, "c1")).toEqual([]);
  });
});
