import { describe, expect, it } from "vitest";

import {
  DeepResearchBudgetExceededError,
  DeepResearchBudgetLedger,
  DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
  normalizeMaxDeepResearchProviderCalls,
} from "./budget-ledger";

describe("DeepResearchBudgetLedger", () => {
  it("atomically rejects debits beyond each hard limit", () => {
    const ledger = new DeepResearchBudgetLedger({ providerCalls: 2 });

    ledger.consume("providerCalls");
    ledger.consume("providerCalls");

    expect(() => ledger.consume("providerCalls")).toThrow(
      DeepResearchBudgetExceededError,
    );
    expect(ledger.snapshot().providerCalls).toEqual({
      used: 2,
      limit: 2,
      remaining: 0,
    });
  });

  it("admits only the remaining part of a page-fetch batch", () => {
    const ledger = new DeepResearchBudgetLedger({ pageFetches: 3 });

    expect(ledger.take("pageFetches", 2)).toBe(2);
    expect(ledger.take("pageFetches", 4)).toBe(1);
    expect(ledger.take("pageFetches", 1)).toBe(0);
  });

  it("normalizes invalid tenant provider budgets to the independent default", () => {
    expect(normalizeMaxDeepResearchProviderCalls(6)).toBe(6);
    expect(normalizeMaxDeepResearchProviderCalls(60)).toBe(60);
    expect(normalizeMaxDeepResearchProviderCalls(5)).toBe(
      DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
    );
    expect(normalizeMaxDeepResearchProviderCalls("24")).toBe(
      DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
    );
  });
});
