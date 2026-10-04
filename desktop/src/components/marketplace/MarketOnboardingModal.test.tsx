import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { MarketOnboardingModal } from "./MarketOnboardingModal";

function renderModal(node: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("MarketOnboardingModal", () => {
  it("renders hero title, four value points and the acknowledge button", () => {
    const html = renderModal(<MarketOnboardingModal open onDismiss={() => {}} />);
    expect(html).toContain(i18n.t("onboarding.title", { ns: "marketplace" }));
    for (const i of [1, 2, 3, 4]) {
      expect(html).toContain(i18n.t(`onboarding.point${i}`, { ns: "marketplace" }));
    }
    expect(html).toContain(i18n.t("onboarding.gotIt", { ns: "marketplace" }));
  });

  it("renders nothing when closed", () => {
    const html = renderModal(<MarketOnboardingModal open={false} onDismiss={() => {}} />);
    expect(html).toBe("");
  });

  it("renders chrome in English", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = renderModal(<MarketOnboardingModal open onDismiss={() => {}} />);
      expect(html).toContain(i18n.t("onboarding.title", { ns: "marketplace" }));
      expect(html).toContain(i18n.t("onboarding.gotIt", { ns: "marketplace" }));
      expect(html).not.toContain("我知道了");
    } finally {
      await i18n.changeLanguage("zh");
    }
  });
});
