// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { SelectionQuotePopover } from "./selection-quote-popover";

afterEach(() => {
  cleanup();
});

describe("SelectionQuotePopover", () => {
  it("keeps a single quote control when scratch is not provided", () => {
    render(<SelectionQuotePopover anchor={{ top: 10, left: 20 }} onQuote={() => undefined} />);
    expect(screen.getByText(i18n.t("preview.quoteToChat", { ns: "workspace" }))).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t("preview.openScratch", { ns: "workspace" }))).toBeNull();
  });

  it("adds a scratch control beside quote when both callbacks exist", () => {
    render(
      <SelectionQuotePopover
        anchor={{ top: 10, left: 20 }}
        onQuote={() => undefined}
        onOpenScratch={() => undefined}
      />,
    );
    expect(screen.getByText(i18n.t("preview.quoteToChat", { ns: "workspace" }))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("preview.openScratch", { ns: "workspace" }))).toBeTruthy();
  });
});
