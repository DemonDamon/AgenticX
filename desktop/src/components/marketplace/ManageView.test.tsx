import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { ManageView } from "./ManageView";

function renderView(props?: Partial<Parameters<typeof ManageView>[0]>) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ManageView
        onBack={() => {}}
        onUse={() => {}}
        onOpenAdvancedSettings={() => {}}
        mcpEntries={[]}
        {...props}
      />
    </I18nextProvider>,
  );
}

/** renderToStaticMarkup 不跑 useEffect,bridge 不会被调用;初始态 loading=true、计数为 0。 */
describe("ManageView", () => {
  it("renders back link, header, tabs and loading state", () => {
    const html = renderView();
    expect(html).toContain(i18n.t("manageView.back", { ns: "marketplace" }));
    expect(html).toContain(i18n.t("manageView.title", { ns: "marketplace" }));
    expect(html).toContain(i18n.t("manageView.subtitle", { ns: "marketplace" }));
    expect(html).toContain(i18n.t("manageView.tabs.plugins", { ns: "marketplace", count: 0 }));
    expect(html).toContain(i18n.t("manageView.tabs.skills", { ns: "marketplace", count: 0 }));
    expect(html).toContain(i18n.t("manageView.advancedSettings", { ns: "marketplace" }));
    expect(html).toContain(i18n.t("loading", { ns: "marketplace" }));
  });

  it("renders search placeholder for the default plugins tab", () => {
    const html = renderView();
    expect(html).toContain(i18n.t("manageView.searchPlugins", { ns: "marketplace" }));
  });

  it("renders header in English", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = renderView();
      expect(html).toContain(i18n.t("manageView.title", { ns: "marketplace" }));
      expect(html).toContain(i18n.t("manageView.back", { ns: "marketplace" }));
      expect(html).not.toContain("返回市场");
    } finally {
      await i18n.changeLanguage("zh");
    }
  });
});
