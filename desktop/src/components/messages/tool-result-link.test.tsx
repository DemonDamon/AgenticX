// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { Message } from "../../store";
import { _resetChatExternalLinkForTests, getPendingChatExternalLink } from "../../utils/chat-external-link";
import { _resetTrustedExternalHostsForTests } from "../../utils/trusted-external-hosts";
import { MarkdownContext } from "./markdown-components";
import { ToolCallCard } from "./ToolCallCard";

afterEach(() => {
  _resetChatExternalLinkForTests();
  _resetTrustedExternalHostsForTests();
});

function toolMessage(): Message {
  return {
    id: "tool-web-search",
    role: "tool",
    toolName: "web_search",
    toolStatus: "completed",
    content: "1. Java 27\nURL: https://www.sohu.com/a/1076845991_115288\n摘要: demo",
  };
}

describe("tool result http links", () => {
  it("asks before opening when the chat link handler is provided", () => {
    const onHttpLinkClick = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <MarkdownContext.Provider value={{ onHttpLinkClick }}>
          <ToolCallCard message={toolMessage()} forceExpand />
        </MarkdownContext.Provider>
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "https://www.sohu.com/a/1076845991_115288" }));
    expect(onHttpLinkClick).toHaveBeenCalledWith("https://www.sohu.com/a/1076845991_115288");
    expect(getPendingChatExternalLink()).toBeNull();
  });
});
