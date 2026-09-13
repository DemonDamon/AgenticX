import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { AllowAllConfirmDialog } from "./AllowAllConfirmDialog";

describe("AllowAllConfirmDialog", () => {
  it("renders a warning title, risks, and a high-emphasis enable action", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain(i18n.t("composer.allowAllTitle", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRiskDelete", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRiskLeak", { ns: "chat" }));
    expect(html).toContain(i18n.t("composer.allowAllRisks", { ns: "chat" }));
    // 审批与隔离是两件事：不再询问 ≠ 关掉工作区隔离。
    expect(html).toContain(i18n.t("composer.allowAllFooter", { ns: "chat" }));
    expect(html).not.toContain("直接在本机执行");
    expect(html).toContain(i18n.t("composer.enable", { ns: "chat" }));
    expect(html).toContain(i18n.t("cancel", { ns: "common" }));
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("bg-btnPrimary");
  });

  it("does not render when closed", () => {
    const html = renderToStaticMarkup(
      <AllowAllConfirmDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(html).toBe("");
  });
});
