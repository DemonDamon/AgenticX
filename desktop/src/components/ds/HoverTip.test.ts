import { describe, expect, it } from "vitest";
import { pickHoverTipPlacement } from "./HoverTip";

describe("pickHoverTipPlacement", () => {
  it("flips above → below when the target sits under the window chrome", () => {
    expect(
      pickHoverTipPlacement("above", { top: 36, bottom: 64 }, 800),
    ).toBe("below");
  });

  it("keeps above when there is room under the titlebar", () => {
    expect(
      pickHoverTipPlacement("above", { top: 120, bottom: 148 }, 800),
    ).toBe("above");
  });

  it("flips below → above when the target is near the viewport bottom", () => {
    expect(
      pickHoverTipPlacement("below", { top: 760, bottom: 788 }, 800),
    ).toBe("above");
  });
});
