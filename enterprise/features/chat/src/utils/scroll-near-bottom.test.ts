import { describe, expect, it } from "vitest";
import { isNearBottom, shouldShowScrollToBottomFab } from "./scroll-near-bottom";

function mockScrollEl(partial: Partial<HTMLElement>): HTMLElement {
  return partial as HTMLElement;
}

describe("scroll-near-bottom", () => {
  it("detects near bottom within threshold", () => {
    const el = mockScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 520,
    });
    expect(isNearBottom(el, 96)).toBe(true);
  });

  it("detects scrolled up", () => {
    const el = mockScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100,
    });
    expect(isNearBottom(el, 96)).toBe(false);
    expect(shouldShowScrollToBottomFab(el, 96)).toBe(true);
  });

  it("hides fab when content does not overflow", () => {
    const el = mockScrollEl({
      scrollHeight: 400,
      clientHeight: 400,
      scrollTop: 0,
    });
    expect(shouldShowScrollToBottomFab(el, 96)).toBe(false);
  });
});
