import { describe, expect, it } from "vitest";
import { clampHoverTipLeft, pickHoverTipPlacement } from "./HoverTip";

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

describe("clampHoverTipLeft", () => {
  it("keeps a centered tip inside the viewport", () => {
    expect(clampHoverTipLeft(10, 800)).toBeGreaterThan(10);
    expect(clampHoverTipLeft(790, 800)).toBeLessThan(790);
    expect(clampHoverTipLeft(400, 800)).toBe(400);
  });
});
