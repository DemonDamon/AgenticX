import { describe, expect, it } from "vitest";
import {
  MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
  canTrustNoClarification,
} from "./clarification-policy";

describe("deep-research clarification confidence policy", () => {
  it("requires both existing confidence values to reach the stricter threshold", () => {
    expect(
      canTrustNoClarification({
        routeConfidence: MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
        queryConfidence: MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
      }),
    ).toBe(true);
    expect(
      canTrustNoClarification({
        routeConfidence: MIN_TRUSTED_CLARIFICATION_CONFIDENCE - 0.01,
        queryConfidence: 0.99,
      }),
    ).toBe(false);
    expect(
      canTrustNoClarification({
        routeConfidence: 0.99,
        queryConfidence: MIN_TRUSTED_CLARIFICATION_CONFIDENCE - 0.01,
      }),
    ).toBe(false);
  });

  it("rejects missing and malformed confidence values", () => {
    expect(canTrustNoClarification(undefined)).toBe(false);
    expect(
      canTrustNoClarification({ routeConfidence: Number.NaN, queryConfidence: 1 }),
    ).toBe(false);
    expect(
      canTrustNoClarification({
        routeConfidence: 1,
        queryConfidence: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
  });
});
