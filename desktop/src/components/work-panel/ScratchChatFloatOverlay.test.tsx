// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { ScratchChat } from "../../utils/scratch-chat";
import { ScratchChatFloatOverlay } from "./ScratchChatFloatOverlay";

const chat: ScratchChat = {
  id: "sc-1",
  title: "关于这段回复",
  sourceKind: "message",
  sourceKey: "message:m1",
  quotedContent: "引用正文",
  sessionId: "",
  messages: [],
  floating: true,
};

afterEach(() => {
  cleanup();
});

describe("ScratchChatFloatOverlay", () => {
  it("renders the docked body and docks without destroying", () => {
    const onDock = vi.fn();
    render(
      <ScratchChatFloatOverlay chat={chat} onDock={onDock} onSend={async () => true} />,
    );
    expect(screen.getByText("关于这段回复")).toBeTruthy();
    expect(screen.getByText("引用正文")).toBeTruthy();
    expect(screen.getByPlaceholderText(i18n.t("work.scratchComposerPlaceholder", { ns: "workspace" }))).toBeTruthy();
    expect(screen.queryByText(i18n.t("work.scratchFloated", { ns: "workspace" }))).toBeNull();
    fireEvent.click(screen.getByLabelText(i18n.t("work.scratchDock", { ns: "workspace" })));
    expect(onDock).toHaveBeenCalledTimes(1);
  });
});
