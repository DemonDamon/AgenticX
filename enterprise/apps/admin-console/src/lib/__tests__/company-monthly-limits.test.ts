import { describe, expect, it } from "vitest";
import {
  companyMonthlyLimits,
  sessionTokenLimits,
  withCompanyMonthlyLimits,
  withSessionTokenLimits,
  type BudgetConfig,
} from "../company-monthly-limits";

const BASE: BudgetConfig = {
  updatedAt: "2026-08-12T00:00:00.000Z",
  defaults: { unit: "tokens", period: "month", limit: 50, action: "block" },
  departments: {
    research: { unit: "tokens", period: "month", limit: 10_000, action: "warn" },
  },
};

describe("company monthly limits", () => {
  it("migrates a legacy default hard limit without losing it", () => {
    expect(companyMonthlyLimits(BASE)).toEqual({ tokens: 50, costUsd: 0 });
    expect(
      companyMonthlyLimits({
        ...BASE,
        defaults: { unit: "cost_usd", period: "month", limit: 200.5, action: "block" },
      }),
    ).toEqual({ tokens: 0, costUsd: 200.5 });
  });

  it("stores token and cost hard limits together while preserving scoped budgets", () => {
    const next = withCompanyMonthlyLimits(BASE, { tokens: 1_000_000, costUsd: 200.5 });
    expect(next.companyLimits).toEqual({ tokens: 1_000_000, costUsd: 200.5 });
    expect(next.defaults?.limit).toBe(0);
    expect(next.departments).toEqual(BASE.departments);
  });

  it("uses the standard session alert defaults without rewriting unrelated limits", () => {
    expect(sessionTokenLimits(BASE)).toEqual({
      warningTokensPerSession: 500_000,
      maxTokensPerSession: 1_000_000,
    });

    const next = withSessionTokenLimits(BASE, {
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });
    expect(next.sessionTokenLimits).toEqual({
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });
    expect(next.defaults).toEqual(BASE.defaults);
    expect(next.departments).toEqual(BASE.departments);
  });

  it("keeps session limits when monthly limits are saved", () => {
    const withSession = withSessionTokenLimits(BASE, {
      warningTokensPerSession: 600_000,
      maxTokensPerSession: 1_200_000,
    });
    const next = withCompanyMonthlyLimits(withSession, {
      tokens: 2_000_000,
      costUsd: 300,
    });
    expect(next.sessionTokenLimits).toEqual(withSession.sessionTokenLimits);
  });
});
