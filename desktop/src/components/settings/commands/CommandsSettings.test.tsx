/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n/i18n";
import { useAppStore } from "../../../store";
import { CommandsSettings } from "./CommandsSettings";

describe("CommandsSettings", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    useAppStore.setState({ apiBase: "http://studio.test", apiToken: "tok" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ commands: [] }),
      })),
    );
  });

  it("shows the empty state and keeps the dialog open for a reserved name", async () => {
    render(<CommandsSettings />);
    expect(await screen.findByText("暂无指令")).toBeTruthy();
    fireEvent.click(screen.getByText("创建"));
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "perf" } });
    fireEvent.change(inputs[2], { target: { value: "不要占用" } });
    fireEvent.click(screen.getByText("确认"));
    expect(screen.getByText("该名称已保留")).toBeTruthy();
    expect(screen.getByText("创建指令")).toBeTruthy();
  });
});
