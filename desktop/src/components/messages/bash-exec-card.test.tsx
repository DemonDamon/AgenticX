// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { Message } from "../../store";
import { ToolCallCard } from "./ToolCallCard";

function bashMessage(content: string, status: Message["toolStatus"] = "done"): Message {
  return {
    id: "bash-1",
    role: "tool",
    toolName: "bash_exec",
    toolStatus: status,
    toolArgs: { command: "cd /tmp && true" },
    content,
  };
}

function renderCard(message: Message) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToolCallCard message={message} forceExpand />
    </I18nextProvider>,
  );
}

describe("ToolCallCard bash_exec envelope", () => {
  it("does not dump empty success protocol into the card body", () => {
    renderCard(bashMessage("exit_code=0\nstdout:\n(empty)\nstderr:\n(empty)"));
    expect(screen.queryByText(/exit_code=/)).toBeNull();
    expect(screen.queryByText(/^\s*stdout:/)).toBeNull();
    expect(screen.queryByText("(empty)")).toBeNull();
    expect(screen.getByText("cd /tmp && true")).toBeTruthy();
  });

  it("shows only the real stderr on failure", () => {
    renderCard(
      bashMessage(
        [
          "exit_code=1",
          "stdout:",
          "(empty)",
          "stderr:",
          "wc: /tmp/typesafe_skill.md: open: No such file or directory",
        ].join("\n"),
      ),
    );
    expect(screen.getByText(/wc: \/tmp\/typesafe_skill.md/)).toBeTruthy();
    expect(screen.queryByText(/exit_code=/)).toBeNull();
    expect(screen.queryByText("(empty)")).toBeNull();
  });

  it("shows a short failure note when both streams are empty", () => {
    renderCard(bashMessage("exit_code=1\nstdout:\n(empty)\nstderr:\n(empty)", "error"));
    expect(screen.getByText(/命令失败（退出码 1）|Command failed \(exit code 1\)/)).toBeTruthy();
    expect(screen.queryByText(/exit_code=/)).toBeNull();
  });
});
