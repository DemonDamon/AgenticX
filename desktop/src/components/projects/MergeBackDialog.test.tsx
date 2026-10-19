/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { MergeBackDialog, type MergeRoomRef } from "./MergeBackDialog";

const MAIN: MergeRoomRef = { id: "m1", title: "主群", room_kind: "main", parent_room_id: null };
const PARENT: MergeRoomRef = { id: "p1", title: "父群", room_kind: "sub", parent_room_id: "m1" };
const DIRECT: MergeRoomRef = { id: "d1", title: "甲 / 乙", room_kind: "direct", parent_room_id: null };

function renderDialog(overrides: Partial<Parameters<typeof MergeBackDialog>[0]> = {}) {
  return render(
    <MergeBackDialog
      open
      source={PARENT}
      rooms={[MAIN, PARENT, DIRECT]}
      selectedCount={0}
      submitting={false}
      error=""
      onClose={vi.fn()}
      onGenerate={vi.fn(async () => "摘要")}
      onConfirm={vi.fn()}
      {...overrides}
    />,
  );
}

describe("MergeBackDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
  });

  it("disables the selected-messages mode when nothing is selected", () => {
    renderDialog({ selectedCount: 0 });
    const selected = screen.getByRole("radio", { name: "选中的 0 条" }) as HTMLInputElement;
    expect(selected.disabled).toBe(true);
  });

  it("disables confirm while the summary is empty", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "摘要" }));
    const confirm = screen.getByRole("button", { name: "确认合回" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "摘要" }), { target: { value: "结论" } });
    expect(confirm.disabled).toBe(false);
  });

  it("offers only the main room as a direct-chat target", () => {
    renderDialog({ source: DIRECT, rooms: [MAIN, PARENT, DIRECT] });
    const select = screen.getByLabelText("目标") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.text)).toEqual(["主群"]);
  });
});
