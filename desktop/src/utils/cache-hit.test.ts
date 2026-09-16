import { describe, expect, it } from "vitest";
import { formatHitPercent, pickUsageHit } from "./cache-hit";

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

describe("pickUsageHit", () => {
  it("prefers the last-round ratio over session totals", () => {
    expect(
      pickUsageHit({
        lastCached: 29696,
        lastInput: 30300,
        sessionCached: 207300,
        sessionInput: 289500,
      }),
    ).toEqual({
      hit: 98.0,
      cached: 29696,
      input: 30300,
    });
  });

  it("falls back to session totals when the last round has no input", () => {
    expect(
      pickUsageHit({
        lastCached: 0,
        lastInput: 0,
        sessionCached: 400,
        sessionInput: 1000,
      }),
    ).toEqual({
      hit: 40,
      cached: 400,
      input: 1000,
    });
  });
});
