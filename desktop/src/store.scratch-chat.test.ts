import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("scratch chat store", () => {
  const originalPanes = useAppStore.getState().panes;
  const originalHidden = useAppStore.getState().hiddenScratchSessionIds;

  afterEach(() => {
    useAppStore.setState({
      panes: originalPanes,
      hiddenScratchSessionIds: originalHidden,
    });
  });

  it("starts with an empty scratch list on the default pane", () => {
    const pane = useAppStore.getState().panes[0];
    expect(pane).toBeTruthy();
    expect(pane?.scratchChats ?? []).toEqual([]);
  });

  it("reuses the same sourceKey and keeps scratch after clearPaneMessages", () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    expect(paneId).toBeTruthy();

    const first = useAppStore.getState().upsertScratchChat(paneId, {
      title: "关于这段回复",
      sourceKind: "message",
      sourceKey: "message:m1",
      quotedContent: "hello",
    });
    const second = useAppStore.getState().upsertScratchChat(paneId, {
      title: "关于这段回复",
      sourceKind: "message",
      sourceKey: "message:m1",
    });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.chatId).toBe(first.chatId);

    useAppStore.getState().clearPaneMessages(paneId);
    const pane = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(pane?.scratchChats).toHaveLength(1);
    expect(pane?.scratchChats?.[0]?.id).toBe(first.chatId);
  });

  it("keeps a closed scratch session id on the history tombstone list", () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    const created = useAppStore.getState().upsertScratchChat(paneId, {
      title: "关于 fanout",
      sourceKind: "message",
      sourceKey: "message:m-fanout",
    });
    useAppStore.getState().patchScratchChat(paneId, created.chatId, {
      sessionId: "scratch-closed-1",
    });
    expect(useAppStore.getState().hiddenScratchSessionIds).toContain("scratch-closed-1");
    useAppStore.getState().closeScratchChat(paneId, created.chatId);
    expect(useAppStore.getState().hiddenScratchSessionIds).toContain("scratch-closed-1");
    const pane = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(pane?.scratchChats?.some((chat) => chat.id === created.chatId)).toBe(false);
    expect(pane?.parkedScratchChats?.some((chat) => chat.id === created.chatId)).toBe(true);

    const restoredId = useAppStore.getState().restoreParkedScratchChat(paneId, created.chatId);
    expect(restoredId).toBe(created.chatId);
    const restored = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(restored?.scratchChats?.some((chat) => chat.id === created.chatId)).toBe(true);
    expect(restored?.parkedScratchChats ?? []).toEqual([]);
  });

  it("stamps the formal pane session as host and keeps scratches when switching sessions", () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    useAppStore.getState().setPaneSessionId(paneId, "formal-host");
    const created = useAppStore.getState().upsertScratchChat(paneId, {
      title: "关于这段回复",
      sourceKind: "message",
      sourceKey: "message:m-host-switch",
    });
    const afterCreate = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(afterCreate?.scratchChats?.find((chat) => chat.id === created.chatId)?.hostSessionId).toBe(
      "formal-host",
    );
    useAppStore.getState().setPaneSessionId(paneId, "other-formal");
    const afterSwitch = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(afterSwitch?.scratchChats?.find((chat) => chat.id === created.chatId)?.hostSessionId).toBe(
      "formal-host",
    );
  });

  it("deletes, promotes, and batch-clears host-scoped scratch chats", () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    useAppStore.getState().setPaneSessionId(paneId, "host-clear");
    const keep = useAppStore.getState().upsertScratchChat(paneId, {
      title: "keep-on-other-host",
      sourceKind: "message",
      sourceKey: "message:keep-other",
    });
    useAppStore.getState().patchScratchChat(paneId, keep.chatId, {
      hostSessionId: "other-host",
      sessionId: "sid-keep",
    });
    const gone = useAppStore.getState().upsertScratchChat(paneId, {
      title: "gone",
      sourceKind: "message",
      sourceKey: "message:gone-host",
    });
    useAppStore.getState().patchScratchChat(paneId, gone.chatId, { sessionId: "sid-gone" });
    const promoted = useAppStore.getState().upsertScratchChat(paneId, {
      title: "promote-me",
      sourceKind: "message",
      sourceKey: "message:promote",
    });
    useAppStore.getState().patchScratchChat(paneId, promoted.chatId, { sessionId: "sid-promote" });
    expect(useAppStore.getState().hiddenScratchSessionIds).toContain("sid-promote");

    expect(useAppStore.getState().promoteScratchChat(paneId, promoted.chatId)).toBe("sid-promote");
    expect(useAppStore.getState().hiddenScratchSessionIds).not.toContain("sid-promote");

    expect(useAppStore.getState().deleteScratchChat(paneId, gone.chatId)).toBe("sid-gone");
    const batch = useAppStore.getState().upsertScratchChat(paneId, {
      title: "batch-clear",
      sourceKind: "message",
      sourceKey: "message:batch-clear",
    });
    useAppStore.getState().patchScratchChat(paneId, batch.chatId, { sessionId: "sid-batch" });
    const cleared = useAppStore.getState().clearHostScratchChats(paneId, "host-clear");
    expect(cleared).toEqual(["sid-batch"]);
    const pane = useAppStore.getState().panes.find((item) => item.id === paneId);
    expect(pane?.scratchChats?.some((chat) => chat.id === keep.chatId)).toBe(true);
    expect(pane?.scratchChats?.some((chat) => chat.id === gone.chatId)).toBe(false);
    expect(pane?.scratchChats?.some((chat) => chat.id === promoted.chatId)).toBe(false);
    expect(pane?.scratchChats?.some((chat) => chat.id === batch.chatId)).toBe(false);
  });
});
