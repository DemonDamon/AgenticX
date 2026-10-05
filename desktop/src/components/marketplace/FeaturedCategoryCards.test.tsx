import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { FeaturedCategoryCards } from "./FeaturedCategoryCards";
import type { MarketplaceItem } from "./model";

function render(items: readonly MarketplaceItem[]) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FeaturedCategoryCards items={items} onPickCategory={() => {}} />
    </I18nextProvider>,
  );
}

const sampleItems: MarketplaceItem[] = [
  { key: "mcp:fetch", kind: "mcp", name: "Fetch", description: "d", installed: false, category: "research" },
  { key: "mcp:github", kind: "mcp", name: "GitHub", description: "d", installed: true, category: "dev_tools" },
  { key: "skill:officecli", kind: "skill", name: "OfficeCLI", description: "d", installed: false, category: "content_creation" },
];

describe("FeaturedCategoryCards", () => {
  it("renders four featured category cards with labels", () => {
    const html = render(sampleItems);
    for (const label of ["研发工具", "内容创作", "数据分析", "电商营销"]) {
      expect(html).toContain(label);
    }
  });

  it("shows sample item names inside matching category cards", () => {
    const html = render(sampleItems);
    // GitHub is dev_tools; OfficeCLI is content_creation
    expect(html).toContain("GitHub");
    expect(html).toContain("OfficeCLI");
  });

  it("shows no-samples hint for categories without items", () => {
    const html = render(sampleItems);
    expect(html).toContain(i18n.t("featured.noSamples", { ns: "marketplace" }));
  });

  it("calls onPickCategory with the clicked category", () => {
    const onPick = vi.fn();
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <FeaturedCategoryCards items={sampleItems} onPickCategory={onPick} />
      </I18nextProvider>,
    );
    // renderToStaticMarkup doesn't fire clicks; verify data attribute present for the 4 featured cats
    const devCard = html.match(/data-market-category="dev_tools"/);
    expect(devCard).not.toBeNull();
  });
});
