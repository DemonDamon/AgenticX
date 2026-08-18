import { describe, expect, it } from "vitest";
import {
  mergeBudgetConfigPatch,
  normalizeBudgetConfig,
  requestedBudgetVersion,
} from "../budget-config";

const STORED_AT = new Date("2026-08-18T08:00:00.000Z");
const UPDATED_AT = new Date("2026-08-18T08:01:00.000Z");

function storedConfig() {
  return normalizeBudgetConfig(
    {
      companyLimits: { tokens: 1_000_000, costUsd: 50 },
      sessionTokenLimits: {
        warningTokensPerSession: 500_000,
        maxTokensPerSession: 1_000_000,
      },
      defaults: {
        unit: "tokens",
        period: "week",
        limit: 70_000,
        warnThresholdPct: 75,
        action: "warn",
      },
      tenants: {
        "tenant-child": {
          unit: "cost_usd",
          period: "month",
          limit: 100,
          action: "block",
        },
      },
      departments: {
        research: {
          unit: "tokens",
          period: "day",
          limit: 20_000,
          action: "warn",
        },
      },
      users: {
        analyst: {
          unit: "tokens",
          period: "month",
          limit: 200_000,
          action: "fallback",
          fallbackModel: "economy-model",
        },
      },
    },
    STORED_AT,
  );
}

describe("budget config patch merge", () => {
  it("changes only submitted organization controls and preserves all scope rules", () => {
    const current = storedConfig();
    const next = mergeBudgetConfigPatch(
      current,
      {
        companyLimits: { tokens: 2_000_000, costUsd: 125 },
        sessionTokenLimits: {
          warningTokensPerSession: 750_000,
          maxTokensPerSession: 1_500_000,
        },
      },
      UPDATED_AT,
    );

    expect(next.companyLimits).toEqual({ tokens: 2_000_000, costUsd: 125 });
    expect(next.sessionTokenLimits).toEqual({
      warningTokensPerSession: 750_000,
      maxTokensPerSession: 1_500_000,
    });
    expect(next.defaults).toEqual(current.defaults);
    expect(next.tenants).toEqual(current.tenants);
    expect(next.departments).toEqual(current.departments);
    expect(next.users).toEqual(current.users);
    expect(next.updatedAt).toBe(UPDATED_AT.toISOString());
  });

  it("preserves weekly rules across normalization and patch writes", () => {
    const current = storedConfig();
    expect(current.defaults?.period).toBe("week");

    const next = mergeBudgetConfigPatch(
      current,
      { companyLimits: { tokens: 3_000_000, costUsd: 0 } },
      UPDATED_AT,
    );
    expect(next.defaults?.period).toBe("week");
  });

  it("keeps replace semantics for an explicitly submitted scope map", () => {
    const next = mergeBudgetConfigPatch(storedConfig(), { departments: {} }, UPDATED_AT);
    expect(next.departments).toEqual({});
    expect(next.users).toHaveProperty("analyst");
  });

  it("prefers an explicit expected version over a config snapshot timestamp", () => {
    expect(
      requestedBudgetVersion(
        { updatedAt: "2026-08-18T08:00:00.000Z" },
        "2026-08-18T09:00:00.000Z",
      )?.toISOString(),
    ).toBe("2026-08-18T09:00:00.000Z");
  });
});
