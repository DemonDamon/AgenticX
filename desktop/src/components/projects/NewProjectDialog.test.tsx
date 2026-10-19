/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { NewProjectDialog } from "./NewProjectDialog";

vi.mock("../../store", () => ({
  useAppStore: (
    selector: (state: {
      avatars: Array<{ id: string; name: string }>;
      mcpServers: Array<{ name: string; connected: boolean }>;
    }) => unknown,
  ) => selector({ avatars: [], mcpServers: [] }),
}));

describe("NewProjectDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
  });

  it("disables confirm until the name is filled, clamps the name, and replaces instructions", () => {
    render(
      <NewProjectDialog
        open
        initialInstructions="原来的指令"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "确定" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const name = screen.getByLabelText("项目名称") as HTMLInputElement;
    const raw = "一二三四五六七八九十一二三四五六";
    fireEvent.change(name, { target: { value: raw } });
    expect(name.value).toBe(raw.slice(0, 15));
    expect(raw).toHaveLength(16);
    expect(confirm.disabled).toBe(false);

    const instructions = screen.getByLabelText(/指令/) as HTMLTextAreaElement;
    expect(instructions.value).toBe("原来的指令");
    fireEvent.change(screen.getByLabelText("选择模板"), { target: { value: "product-flow" } });
    expect(instructions.value).toBe("从需求澄清、PRD 撰写到研发测试验收的完整闭环。");
  });
});
