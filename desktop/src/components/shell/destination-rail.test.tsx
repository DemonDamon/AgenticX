import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { DestinationRail } from "./destination-rail";

let settingsOpen = false;

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: { settings: { open: boolean } }) => unknown) =>
    selector({ settings: { open: settingsOpen } }),
}));

describe("DestinationRail", () => {
  beforeEach(async () => {
    settingsOpen = false;
    await i18n.changeLanguage("zh");
  });

  it("renders destination buttons when settings are closed", () => {
    const html = renderToStaticMarkup(
      <DestinationRail activeKind={null} onSelect={() => undefined} />,
    );
    expect(html).toContain('aria-label=');
    expect(html).toContain("button");
  });

  it("renders nothing while settings are open so the rail cannot cover Settings content", () => {
    settingsOpen = true;
    const html = renderToStaticMarkup(
      <DestinationRail activeKind={null} onSelect={() => undefined} />,
    );
    expect(html).toBe("");
  });
});
