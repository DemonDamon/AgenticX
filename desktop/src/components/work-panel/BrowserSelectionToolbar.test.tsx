// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { BrowserSelectionToolbar } from "./BrowserSelectionToolbar";

afterEach(() => {
  cleanup();
});

describe("BrowserSelectionToolbar", () => {
  it("keeps quote and adds scratch when both callbacks exist", () => {
    render(
      <BrowserSelectionToolbar
        anchor={{ top: 12, left: 40 }}
        onQuote={() => undefined}
        onCopy={() => undefined}
        onSearch={() => undefined}
        onOpenScratch={() => undefined}
      />,
    );
    expect(screen.getByText(i18n.t("work.quoteToChat", { ns: "workspace" }))).toBeTruthy();
    expect(screen.getByText(i18n.t("work.copy", { ns: "workspace" }))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("work.openScratch", { ns: "workspace" }))).toBeTruthy();
  });

  it("omits scratch when the callback is missing", () => {
    render(
      <BrowserSelectionToolbar
        anchor={{ top: 12, left: 40 }}
        onQuote={() => undefined}
        onCopy={() => undefined}
        onSearch={() => undefined}
      />,
    );
    expect(screen.getByText(i18n.t("work.quoteToChat", { ns: "workspace" }))).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t("work.openScratch", { ns: "workspace" }))).toBeNull();
  });
});
