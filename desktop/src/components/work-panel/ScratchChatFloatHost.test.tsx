// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { useAppStore } from "../../store";
import { ScratchChatFloatHost } from "./ScratchChatFloatHost";

afterEach(() => {
  cleanup();
});

describe("ScratchChatFloatHost", () => {
  it("keeps the float overlay mounted without WorkPanel", () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    expect(paneId).toBeTruthy();
    const { chatId } = useAppStore.getState().upsertScratchChat(paneId, {
      title: "关于这段回复",
      sourceKind: "message",
      sourceKey: "message:float-host",
      quotedContent: "引用正文",
    });
    useAppStore.getState().setScratchChatFloating(paneId, chatId, true);

    const onDock = vi.fn();
    render(<ScratchChatFloatHost paneId={paneId} onDock={onDock} />);

    expect(screen.getByText("关于这段回复")).toBeTruthy();
    expect(screen.getByText("引用正文")).toBeTruthy();
    expect(document.querySelector('[data-slot="scratch-composer"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="scratch-model-picker"]')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(i18n.t("work.scratchClearQuote", { ns: "workspace" })));
    const after = useAppStore
      .getState()
      .panes.find((pane) => pane.id === paneId)
      ?.scratchChats?.find((item) => item.id === chatId);
    expect(after?.quotedContent).toBeUndefined();
    expect(screen.queryByText("引用正文")).toBeNull();
  });
});
