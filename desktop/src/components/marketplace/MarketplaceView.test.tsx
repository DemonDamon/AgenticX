import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { MarketplaceView } from "./MarketplaceView";
import { __resetMarketplaceSessionCacheForTests } from "./useMarketplaceData";

function renderView() {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MarketplaceView />
    </I18nextProvider>,
  );
}

/** renderToStaticMarkup 不跑 useEffect,bridge 不会被调用;本地连接器供给仍可即时上屏。 */
describe("MarketplaceView", () => {
  beforeEach(() => {
    __resetMarketplaceSessionCacheForTests();
  });

  it("renders header, kind tabs, featured cards and connector grid without blocking spinner", () => {
    const html = renderView();
    expect(html).toContain(i18n.t("title", { ns: "marketplace" }));
    expect(html).toContain(i18n.t("manage", { ns: "marketplace" }));
    for (const tab of ["all", "connectors", "mcp", "skills", "agents", "commands"] as const) {
      expect(html).toContain(i18n.t(`tabs.${tab}`, { ns: "marketplace" }));
    }
    for (const id of ["office", "connectors", "toolkit"] as const) {
      expect(html).toContain(i18n.t(`featured.${id}.title`, { ns: "marketplace" }));
    }
    // 全部 tab 有本地连接器供给,首屏不应被「加载中」挡住。
    expect(html).not.toContain(i18n.t("loading", { ns: "marketplace" }));
  });

  it("renders search placeholder for the default all tab", () => {
    const html = renderView();
    expect(html).toContain(i18n.t("search.all", { ns: "marketplace" }));
  });

  it("renders chrome in English", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = renderView();
      expect(html).toContain(i18n.t("title", { ns: "marketplace" }));
      expect(html).toContain(i18n.t("featured.connectors.title", { ns: "marketplace" }));
      expect(html).not.toContain("插件市场");
    } finally {
      await i18n.changeLanguage("zh");
    }
  });
});
