import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { ComposerModeMenu } from "./ComposerModeMenu";
import { TurnIntentChip } from "./TurnIntentChip";

describe("ComposerModeMenu", () => {
  it("renders the Mode row in English", () => {
    const html = renderToStaticMarkup(
      <ComposerModeMenu intent="default" onIntentChange={() => {}} />,
    );
    expect(html).toContain(i18n.t("composer.mode", { ns: "chat" }));
    expect(html).not.toContain(i18n.t("composer.modePlan", { ns: "chat" }));
  });

  it("exposes Multitask copy on the Mode control when isolate is on", () => {
    const html = renderToStaticMarkup(
      <ComposerModeMenu intent="isolate" onIntentChange={() => {}} />,
    );
    expect(html).toContain(i18n.t("composer.modeMultitaskHint", { ns: "chat" }));
  });
});

describe("TurnIntentChip", () => {
  it("shows the Plan label", () => {
    const html = renderToStaticMarkup(<TurnIntentChip intent="plan" onClear={() => {}} />);
    expect(html).toContain(i18n.t("composer.modePlan", { ns: "chat" }));
  });

  it("shows the Multitask label", () => {
    const html = renderToStaticMarkup(<TurnIntentChip intent="isolate" onClear={() => {}} />);
    expect(html).toContain(i18n.t("composer.modeMultitask", { ns: "chat" }));
  });
});
