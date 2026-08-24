import { describe, expect, it } from "vitest";
import { formatHitPercent } from "./cache-hit";

describe("formatHitPercent", () => {
  it("returns null when there is no last-turn input", () => {
    expect(formatHitPercent(0, 0)).toBeNull();
  });

  it("keeps one decimal place", () => {
    expect(formatHitPercent(588, 1000)).toBe(58.8);
  });

  it("returns 0 when input exists but nothing was cached", () => {
    expect(formatHitPercent(0, 1000)).toBe(0);
  });
});
