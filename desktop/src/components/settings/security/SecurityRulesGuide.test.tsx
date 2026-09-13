import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n/i18n";
import { SecurityRulesGuide } from "./SecurityRulesGuide";

function renderGuide(onDismiss?: () => void) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SecurityRulesGuide onDismiss={onDismiss} />
    </I18nextProvider>,
  );
}

describe("SecurityRulesGuide", () => {
  it("explains the difference between run mode and the rule panels", () => {
    const html = renderGuide();
    expect(html).toContain(i18n.t("settings:security.rulesGuide.title"));
    expect(html).toContain(i18n.t("settings:security.rulesGuide.body"));
    expect(html).not.toContain(i18n.t("settings:security.rulesGuide.dismissAria"));
  });

  it("can be dismissed when opened from 自定义", () => {
    const html = renderGuide(vi.fn());
    expect(html).toContain(i18n.t("settings:security.rulesGuide.dismissAria"));
  });
});
