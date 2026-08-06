import { describe, expect, it } from "vitest";
import { isQuotaExhausted } from "./quota-status";

describe("isQuotaExhausted", () => {
  it("does not treat unlimited quota as exhausted", () => {
    expect(
      isQuotaExhausted({
        monthly: { remaining: null, unlimited: true },
      }),
    ).toBe(false);
  });

  it("detects a finite window with no remaining tokens", () => {
    expect(
      isQuotaExhausted({
        monthly: { remaining: 0, unlimited: false },
      }),
    ).toBe(true);
  });

  it("does not warn while a finite quota still has tokens", () => {
    expect(
      isQuotaExhausted({
        daily: { remaining: 1, unlimited: false },
        weekly: { remaining: 200, unlimited: false },
        monthly: { remaining: 1000, unlimited: false },
      }),
    ).toBe(false);
  });
});
