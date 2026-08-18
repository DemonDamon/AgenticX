import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_TOKEN_LIMITS,
  isValidSessionTokenLimits,
  normalizeSessionTokenLimits,
} from "../session-token-limits";

describe("session token limits", () => {
  it("uses the enterprise defaults when no policy is stored", () => {
    expect(normalizeSessionTokenLimits(undefined)).toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
    expect(DEFAULT_SESSION_TOKEN_LIMITS).toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });
  });

  it("accepts a bounded warning threshold below the hard stop", () => {
    const value = {
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    };
    expect(isValidSessionTokenLimits(value)).toBe(true);
    expect(normalizeSessionTokenLimits(value)).toEqual(value);
  });

  it.each([
    { warningTokensPerSession: 49_999, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: 500_000, maxTokensPerSession: 99_999 },
    { warningTokensPerSession: 1_000_000, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: 1_500_000, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: 500_000.5, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: "500000", maxTokensPerSession: 1_000_000 },
  ])("rejects an invalid threshold pair: %j", (value) => {
    expect(isValidSessionTokenLimits(value)).toBe(false);
    expect(normalizeSessionTokenLimits(value)).toEqual(DEFAULT_SESSION_TOKEN_LIMITS);
  });
});
