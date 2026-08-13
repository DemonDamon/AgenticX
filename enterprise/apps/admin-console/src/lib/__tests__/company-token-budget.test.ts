import { describe, expect, it } from "vitest";
import {
  companyMonthlyTokenLimit,
  withCompanyMonthlyTokenLimit,
  type BudgetConfig,
} from "../company-token-budget";

const BASE: BudgetConfig = {
  updatedAt: "2026-08-12T00:00:00.000Z",
  defaults: { unit: "cost_usd", period: "month", limit: 50, action: "warn" },
  departments: {
    research: { unit: "tokens", period: "month", limit: 10_000, action: "warn" },
  },
};

describe("company monthly token budget", () => {
  it("only exposes a blocking monthly token default as the company limit", () => {
    expect(companyMonthlyTokenLimit(BASE)).toBe(0);
    expect(
      companyMonthlyTokenLimit({
        ...BASE,
        defaults: { unit: "tokens", period: "month", limit: 200, action: "block" },
      }),
    ).toBe(200);
  });

  it("updates only the default rule and preserves scoped budgets", () => {
    const next = withCompanyMonthlyTokenLimit(BASE, 200.9);
    expect(next.defaults).toMatchObject({
      unit: "tokens",
      period: "month",
      limit: 200,
      action: "block",
      warnThresholdPct: 80,
    });
    expect(next.departments).toEqual(BASE.departments);
  });
});
