import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_BUDGET,
  defaultMemberBudget,
  normalizeBudgetLimit,
  withDefaultMemberBudget,
} from "../default-member-budget";
import {
  companyMonthlyLimits,
  withCompanyMonthlyLimits,
  type BudgetConfig,
} from "../company-monthly-limits";

const CONFIGURED: BudgetConfig = {
  updatedAt: "2026-08-21T00:00:00.000Z",
  companyLimits: { tokens: 0, costUsd: 5000 },
  defaults: { unit: "cost_usd", period: "month", limit: 20, warnThresholdPct: 80, action: "block" },
  departments: { research: { unit: "tokens", period: "month", limit: 10_000, action: "warn" } },
};

describe("default member budget", () => {
  it("reads the tenant default rule", () => {
    expect(defaultMemberBudget(CONFIGURED)).toEqual({
      enabled: true,
      unit: "cost_usd",
      period: "month",
      limit: 20,
      warnThresholdPct: 80,
      action: "block",
    });
  });

  it("treats a zero limit as not configured", () => {
    // 留着一条 limit=0 的规则会让人以为「配过了」，而它实际什么都不限制。
    expect(
      defaultMemberBudget({
        ...CONFIGURED,
        defaults: { unit: "tokens", period: "day", limit: 0, action: "warn" },
      }).enabled,
    ).toBe(false);
    expect(defaultMemberBudget({ updatedAt: "x" })).toEqual(DEFAULT_MEMBER_BUDGET);
  });

  it("falls back on garbage rather than writing an invalid unit or period", () => {
    const got = defaultMemberBudget({
      updatedAt: "x",
      defaults: { unit: "yuan", period: "fortnight", limit: 5, action: "explode" } as never,
    });
    expect(got.unit).toBe("cost_usd");
    expect(got.period).toBe("month");
    expect(got.action).toBe("warn");
  });

  it("keeps token limits whole and lets USD carry cents", () => {
    expect(normalizeBudgetLimit("tokens", 1234.9)).toBe(1234);
    expect(normalizeBudgetLimit("cost_usd", 19.99)).toBe(19.99);
    expect(normalizeBudgetLimit("tokens", -5)).toBe(0);
  });

  it("patches only defaults and carries the version for optimistic concurrency", () => {
    const patch = withDefaultMemberBudget(CONFIGURED, {
      enabled: true,
      unit: "tokens",
      period: "week",
      limit: 500_000.7,
      warnThresholdPct: 90,
      action: "warn",
    });
    expect(patch).toEqual({
      expectedUpdatedAt: CONFIGURED.updatedAt,
      defaults: {
        unit: "tokens",
        period: "week",
        limit: 500_000,
        warnThresholdPct: 90,
        action: "warn",
      },
    });
    expect(Object.keys(patch)).not.toContain("departments");
  });

  it("disabling writes a zero limit instead of deleting the rule", () => {
    const patch = withDefaultMemberBudget(CONFIGURED, {
      ...defaultMemberBudget(CONFIGURED),
      enabled: false,
    });
    expect(patch.defaults.limit).toBe(0);
  });

  it("clamps the warn threshold into 0..100", () => {
    const over = withDefaultMemberBudget(CONFIGURED, {
      ...defaultMemberBudget(CONFIGURED),
      warnThresholdPct: 480,
    });
    expect(over.defaults.warnThresholdPct).toBe(100);
  });
});

describe("company limits no longer clobber a configured default budget", () => {
  it("keeps the default rule when company limits are saved", () => {
    // 不加这个判断的话，管理员配了「每人每月 $20 · block」之后，只要再去公司硬上限
    // 那张卡点一次保存，这条默认预算的 limit 就会被当成旧数据抹成 0——静默的。
    const next = withCompanyMonthlyLimits(CONFIGURED, { tokens: 9_000_000, costUsd: 8000 });
    expect(next.defaults?.limit).toBe(20);
    expect(next.companyLimits).toEqual({ tokens: 9_000_000, costUsd: 8000 });
  });

  it("still migrates genuinely legacy configs that never had companyLimits", () => {
    const legacy: BudgetConfig = {
      updatedAt: "2026-08-12T00:00:00.000Z",
      defaults: { unit: "tokens", period: "month", limit: 50, action: "block" },
    };
    expect(companyMonthlyLimits(legacy)).toEqual({ tokens: 50, costUsd: 0 });
    expect(withCompanyMonthlyLimits(legacy, { tokens: 1000, costUsd: 0 }).defaults?.limit).toBe(0);
  });

  it("does not re-read the default rule as a company limit once migrated", () => {
    expect(companyMonthlyLimits(CONFIGURED)).toEqual({ tokens: 0, costUsd: 5000 });
  });
});
