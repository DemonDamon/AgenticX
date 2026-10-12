// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { AllowAllConfirmDialog } from "./AllowAllConfirmDialog";

afterEach(() => cleanup());

describe("AllowAllConfirmDialog", () => {
  it("renders a warning title, risks, ack checkbox, and a disabled enable action", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain(i18n.t("composer.allowAllTitle", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRiskDelete", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRiskLeak", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRisks", { ns: "chat" }));
    // 审批与隔离是两件事：不再询问 ≠ 关掉工作区隔离。
    expect(html).toContain(i18n.t("composer.allowAllFooter", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllAck", { ns: "chat" }));
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("直接在本机执行");
    expect(html).toContain(i18n.t("composer.enable", { ns: "chat" }));
    expect(html).toContain(i18n.t("cancel", { ns: "common" }));
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("bg-red-600");
  });

  it("keeps enable disabled until the risk ack checkbox is checked", () => {
    const onConfirm = vi.fn();
    render(<AllowAllConfirmDialog open onCancel={vi.fn()} onConfirm={onConfirm} />);

    const enable = screen.getByRole("button", { name: i18n.t("composer.enable", { ns: "chat" }) });
    expect((enable as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(enable);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: i18n.t("composer.allowAllAck", { ns: "chat" }) }));
    expect((enable as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(enable);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(html).toBe("");
  });
});
