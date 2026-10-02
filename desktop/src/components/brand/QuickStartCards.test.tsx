// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QuickStartCards } from "./QuickStartCards";
import { QUICK_START_IDS } from "./quick-start-items";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("QuickStartCards", () => {
  it("renders every card and passes the prompt key on click", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onPick = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<QuickStartCards onPick={onPick} />);
    });
    const buttons = host.querySelectorAll("button");
    expect(buttons.length).toBe(QUICK_START_IDS.length);
    act(() => {
      buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith(`quickStart.${QUICK_START_IDS[1]}.prompt`);
    act(() => root.unmount());
    host.remove();
  });
});
