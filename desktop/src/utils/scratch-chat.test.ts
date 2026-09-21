import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  closeOrParkScratchChat,
  closeScratchChatList,
  collectScratchSessionIds,
  dismissParkedScratchChat,
  excludeScratchSessionsFromHistory,
  attachUnhostedScratchChats,
  clearScratchChatsForHost,
  deleteScratchChatFromLists,
  filterScratchChatsForHost,
  forgetScratchSessionIds,
  mergeHiddenScratchSessionIdsForPersist,
  rememberScratchSessionIds,
  scratchBelongsToHost,
  restoreParkedScratchChat,
  scratchHistoryBlocklist,
  listSummaryScratchChats,
  scratchParkedPreview,
  normalizePersistedScratchChats,
  resolveScratchChatModel,
  scratchSourceKey,
  setScratchFloating,
  shouldConfirmCloseScratch,
  upsertScratchChatList,
  withoutScratchContextFile,
  type ScratchChat,
} from "./scratch-chat";

function chat(partial: Partial<ScratchChat> & Pick<ScratchChat, "id" | "sourceKey">): ScratchChat {
  return {
    title: partial.title ?? "关于这段回复",
    sourceKind: partial.sourceKind ?? "message",
    quotedContent: partial.quotedContent,
    contextFiles: partial.contextFiles,
    sessionId: partial.sessionId ?? "",
    hostSessionId: partial.hostSessionId ?? "",
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
    const afterClose = scratchHistoryBlocklist([{ scratchChats: [] }], rememberScratchSessionIds([], ["scratch-1"]));
    expect(excludeScratchSessionsFromHistory(rows, afterClose).map((row) => row.session_id)).toEqual([
      "main",
      "other",
    ]);
    const parkedIds = collectScratchSessionIds([
      { scratchChats: [], parkedScratchChats: [chat({ id: "p", sourceKey: "message:p", sessionId: "scratch-1" })] },
    ]);
    expect([...parkedIds]).toEqual(["scratch-1"]);
  });

  it("parks a materialized scratch in workspace history and can restore or dismiss it", () => {
    const open = [
      chat({
        id: "c1",
        sourceKey: "message:1",
        sessionId: "sid-1",
        messages: [{ id: "m", role: "user", content: "什么是 fanout" }],
      }),
    ];
    const parkedOnce = closeOrParkScratchChat(open, [], "c1", 1000);
    expect(parkedOnce.open).toEqual([]);
    expect(parkedOnce.parked).toHaveLength(1);
    expect(parkedOnce.parked[0]?.parkedAt).toBe(1000);
    expect(parkedOnce.evicted).toEqual([]);
    expect(scratchParkedPreview(parkedOnce.parked[0]!)).toBe("什么是 fanout");

    const restored = restoreParkedScratchChat([], parkedOnce.parked, "c1");
    expect(restored.open).toHaveLength(1);
    expect(restored.open[0]?.parkedAt).toBeUndefined();
    expect(restored.parked).toEqual([]);

    const dismissed = dismissParkedScratchChat(parkedOnce.parked, "c1");
    expect(dismissed.parked).toEqual([]);
    expect(dismissed.removed?.sessionId).toBe("sid-1");
    expect(listSummaryScratchChats(open, []).map((item) => item.isParked)).toEqual([false]);
    expect(listSummaryScratchChats([], parkedOnce.parked).map((item) => item.isParked)).toEqual([true]);
  });

  it("restores a parked scratch when the same source is opened again", () => {
    const parked = [
      chat({ id: "old", sourceKey: "message:m1", sessionId: "sid-1", parkedAt: 1, title: "关于这段回复" }),
    ];
    const next = upsertScratchChatList(
      [],
      { title: "关于这段回复", sourceKind: "message", sourceKey: "message:m1" },
      "new",
      parked,
    );
    expect(next.reused).toBe(true);
    expect(next.chat.id).toBe("old");
    expect(next.chats).toHaveLength(1);
    expect(next.parked).toEqual([]);
  });

  it("remembers newest scratch session ids first and caps the tombstone list", () => {
    expect(rememberScratchSessionIds(["old", "keep"], ["keep", "fresh"])).toEqual([
      "keep",
      "fresh",
      "old",
    ]);
    const capped = rememberScratchSessionIds(["a", "b", "c"], ["d"], 2);
    expect(capped).toEqual(["d", "a"]);
  });

  it("scopes scratch chats to the host formal session", () => {
    const a = chat({ id: "a", sourceKey: "message:a", hostSessionId: "host-a", sessionId: "scratch-a" });
    const b = chat({ id: "b", sourceKey: "message:b", hostSessionId: "host-b" });
    const unhosted = chat({ id: "c", sourceKey: "message:c" });
    expect(scratchBelongsToHost(a, "host-a")).toBe(true);
    expect(filterScratchChatsForHost([a, b, unhosted], "host-a").map((item) => item.id)).toEqual(["a"]);
    expect(filterScratchChatsForHost([a, b, unhosted], "").map((item) => item.id)).toEqual(["c"]);
    expect(attachUnhostedScratchChats([a, unhosted], "host-a").map((item) => item.hostSessionId)).toEqual([
      "host-a",
      "host-a",
    ]);
  });

  it("deletes one scratch and clears only that host on batch clear", () => {
    const open = [
      chat({ id: "keep", sourceKey: "message:keep", hostSessionId: "host-b" }),
      chat({ id: "gone", sourceKey: "message:gone", hostSessionId: "host-a", sessionId: "sid-gone" }),
    ];
    const parked = [chat({ id: "parked-a", sourceKey: "message:parked", hostSessionId: "host-a", sessionId: "sid-parked" })];
    const deleted = deleteScratchChatFromLists(open, parked, "gone");
    expect(deleted.removed?.id).toBe("gone");
    expect(deleted.open.map((item) => item.id)).toEqual(["keep"]);
    const cleared = clearScratchChatsForHost(open, parked, "host-a");
    expect(cleared.removed.map((item) => item.id).sort()).toEqual(["gone", "parked-a"]);
    expect(cleared.open.map((item) => item.id)).toEqual(["keep"]);
    expect(cleared.parked).toEqual([]);
    expect(forgetScratchSessionIds(["sid-gone", "keep-hidden"], ["sid-gone"])).toEqual(["keep-hidden"]);
  });

  it("stamps hostSessionId on a newly created scratch", () => {
    const next = upsertScratchChatList(
      [],
      { title: "关于这段回复", sourceKind: "message", sourceKey: "message:m-host" },
      "c-host",
      [],
      "formal-1",
    );
    expect(next.chat.hostSessionId).toBe("formal-1");
  });

  it("does not wipe persisted hidden scratch ids when memory is still empty", () => {
    expect(
      mergeHiddenScratchSessionIdsForPersist(["disk-scratch"], [], [{ scratchChats: [] }]),
    ).toEqual(["disk-scratch"]);
  });

  it("keeps closed scratch sessions in workspace history instead of sidebar", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sidebar = readFileSync(join(here, "../components/sidebar/SidebarSessionHistory.tsx"), "utf8");
    const work = readFileSync(join(here, "../components/work-panel/WorkPanel.tsx"), "utf8");
    const workspace = readFileSync(join(here, "../components/WorkspacePanel.tsx"), "utf8");
    const app = readFileSync(join(here, "../App.tsx"), "utf8");
    const nav = readFileSync(join(here, "../hooks/usePaneNavigation.ts"), "utf8");
    const runtime = readFileSync(join(here, "../components/work-panel/use-scratch-chat-runtime.ts"), "utf8");
    expect(sidebar).toContain("scratchHistoryBlocklist");
    expect(sidebar).toContain("hiddenScratchSessionIds");
    expect(work).toContain("parkedScratchChats");
    expect(work).toContain('id="scratch"');
    expect(work).not.toContain("scratch-history");
    expect(work).toContain("promoteScratchChat");
    expect(work).toContain("clearHostScratchChats");
    expect(work).toContain("scratchPromote");
    expect(work).toContain("scratchClearAll");
    expect(workspace).toContain("scratchHistoryBlocklist");
    expect(workspace).toContain("pickPreferredSessionId");
    expect(nav).toContain("scratchHistoryBlocklist");
    expect(app).toContain("mergeHiddenScratchSessionIdsForPersist");
    expect(app).toContain("parkedScratchChats");
    expect(app).toContain("normalizePersistedScratchChats(pane.parkedScratchChats)");
    expect(app).not.toContain("parkedScratchChats: []");
    expect(runtime).toContain("rememberHiddenScratchSessionIds");
  });

  it("normalizes persisted scratch chats and forces floating off", () => {
    const chats = normalizePersistedScratchChats([
      {
        id: "c1",
        title: "关于 report.md",
        sourceKind: "file",
        sourceKey: "file:/tmp/report.md",
        sessionId: "sid-1",
        hostSessionId: "formal-1",
        floating: true,
        messages: [{ id: "m", role: "user", content: "q" }],
        contextFiles: [{ path: "/tmp/report.md", sourcePath: "/tmp/report.md" }],
        modelProvider: "openai",
        modelName: "gpt-test",
      },
      { id: "", title: "bad", sourceKind: "file", sourceKey: "file:x" },
      { title: "no-id", sourceKind: "message", sourceKey: "message:x" },
      { id: "c2", title: "x", sourceKind: "nope", sourceKey: "x" },
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).toBe("c1");
    expect(chats[0]?.floating).toBe(false);
    expect(chats[0]?.sessionId).toBe("sid-1");
    expect(chats[0]?.hostSessionId).toBe("formal-1");
    expect(chats[0]?.messages).toHaveLength(1);
    expect(chats[0]?.modelProvider).toBe("openai");
    expect(chats[0]?.modelName).toBe("gpt-test");
    expect(closeScratchChatList(chats, "c1")).toEqual([]);
  });

  it("resolves the scratch model override before the pane model", () => {
    expect(
      resolveScratchChatModel(
        { modelProvider: "openai", modelName: "gpt-test" },
        { modelProvider: "anthropic", modelName: "sonnet" },
      ),
    ).toEqual({ provider: "openai", model: "gpt-test" });
    expect(resolveScratchChatModel({}, { modelProvider: "anthropic", modelName: "sonnet" })).toEqual({
      provider: "anthropic",
      model: "sonnet",
    });
  });

  it("drops a context file by path", () => {
    expect(
      withoutScratchContextFile(
        [
          { path: "/tmp/a.md", sourcePath: "/tmp/a.md" },
          { path: "/tmp/b.md" },
        ],
        "/tmp/a.md",
      ),
    ).toEqual([{ path: "/tmp/b.md" }]);
    expect(withoutScratchContextFile([{ path: "/tmp/a.md" }], "/tmp/a.md")).toBeUndefined();
  });
});
