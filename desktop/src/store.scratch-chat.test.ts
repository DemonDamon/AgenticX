import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("scratch chat store", () => {
  const originalPanes = useAppStore.getState().panes;

  afterEach(() => {
    useAppStore.setState({ panes: originalPanes });
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
});
