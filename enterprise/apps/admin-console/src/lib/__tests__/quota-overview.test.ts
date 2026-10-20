import { describe, expect, it } from "vitest";
import type { FeatureUsageConfig, MemberSpendingConfig } from "@agenticx/config";
import {
  budgetOverviewForMember,
  featureCountOverview,
  featureUsedByUser,
  loadGroupLimitOverview,
  loadUserQuotaOverview,
  spendingSourceLabel,
  type QuotaOverviewDeps,
} from "../quota-overview";

const budget: MemberSpendingConfig = {
  defaults: { unit: "tokens", period: "month", limit: 1_000_000, action: "warn" },
  groups: { analysts: { unit: "tokens", period: "month", limit: 500_000, action: "warn" } },
  users: { ada: { unit: "tokens", period: "day", limit: 20_000, action: "block" } },
};

const featureUsage: FeatureUsageConfig = {
  defaults: { role: { staff: { searchCallsPerMonth: 30, deepResearchRunsPerMonth: 4 } } },
  groups: { analysts: { searchCallsPerWeek: 8 } },
  users: { ada: { searchCallsPerDay: 3, deepResearchRunsPerDay: 1 } },
};

function deps(overrides: Partial<QuotaOverviewDeps> = {}): QuotaOverviewDeps {
  const base: QuotaOverviewDeps = {
    getBudget: async () => budget,
    getFeatureUsage: async () => featureUsage,
    listGroups: async () => [{ id: "analysts", name: "分析组", memberIds: ["bea"] }],
    listMembers: async () => [
      { id: "ada", deptId: "sales", roleCodes: ["member"] },
      { id: "bea", deptId: "sales", roleCodes: ["member"] },
      { id: "cy", deptId: null, roleCodes: ["member"] },
      { id: "dee", deptId: null, roleCodes: [] },
    ],
    readSpend: async () => [
      { userId: "ada", window: "day", period: "2026-10-20", tokens: 100, costUsd: 0 },
      { userId: "bea", window: "month", period: "2026-10", tokens: 12_000, costUsd: 1 },
      { userId: "cy", window: "month", period: "2026-10", tokens: 40, costUsd: 0 },
    ],
    readFeatureDays: async () => [
      { userId: "ada", feature: "search_provider_calls", day: "2026-10-20", used: 2 },
      { userId: "ada", feature: "deep_research_runs", day: "2026-10-20", used: 1 },
      { userId: "bea", feature: "search_provider_calls", day: "2026-10-19", used: 3 },
    ],
  };
  return { ...base, ...overrides };
}

describe("quota overview sources and remaining counts", () => {
  it("labels a personal exception, a group rule, the everyone default, and no limit", () => {
    expect(budgetOverviewForMember({ budget, userId: "ada" }).source).toBe("user");
    expect(spendingSourceLabel("user")).toBe("个人特例");
    expect(budgetOverviewForMember({ budget, userId: "bea", groupIds: ["analysts"] }).source).toBe("group");
    expect(spendingSourceLabel("group")).toBe("用户组");
    expect(budgetOverviewForMember({ budget, userId: "cy" }).source).toBe("default");
    expect(spendingSourceLabel("default")).toBe("每人默认");
    expect(budgetOverviewForMember({ budget: { defaults: { unit: "tokens", period: "month", limit: 0, action: "warn" } }, userId: "dee" }).source).toBe("none");
    expect(spendingSourceLabel("none")).toBe("未设上限");
  });

  it("uses the matching window's tokens and leaves remaining null when there is no ceiling", () => {
    const personal = budgetOverviewForMember({
      budget,
      userId: "ada",
      usage: { day: { tokens: 100, costUsd: 2 }, month: { tokens: 900, costUsd: 4 } },
    });
    expect(personal.used).toBe(100);
    expect(personal.period).toBe("day");
    expect(personal.periodLabel).toBe("今日");
    expect(personal.rule?.limit).toBe(20_000);

    const open = budgetOverviewForMember({ budget: {}, userId: "dee", usage: { month: { tokens: 7, costUsd: 0 } } });
    expect(open.rule).toBeNull();
    expect(open.used).toBe(7);
  });

  it("computes remaining calls from the tightest configured window", () => {
    const now = new Date("2026-10-20T08:00:00.000Z");
    const used = featureUsedByUser([
      { userId: "ada", feature: "search_provider_calls", day: "2026-10-20", used: 2 },
      { userId: "ada", feature: "search_provider_calls", day: "2026-10-01", used: 9 },
    ], now).get("ada")!.search_provider_calls;
    const personal = featureCountOverview(featureUsage, "search_provider_calls", {
      userId: "ada",
      groupIds: ["analysts"],
      roles: ["member"],
    }, used);
    expect(personal).toMatchObject({ source: "user", window: "day", limit: 3, used: 2, remaining: 1 });

    const group = featureCountOverview(featureUsage, "search_provider_calls", {
      userId: "bea",
      groupIds: ["analysts"],
      roles: ["member"],
    }, { day: 0, week: 3, month: 3 });
    expect(group).toMatchObject({ source: "group", window: "week", limit: 8, used: 3, remaining: 5 });

    const fallback = featureCountOverview(featureUsage, "deep_research_runs", {
      userId: "cy",
      roles: ["member"],
    }, { day: 0, week: 0, month: 1 });
    expect(fallback).toMatchObject({ source: "default", window: "month", limit: 4, remaining: 3 });

    const open = featureCountOverview(undefined, "search_provider_calls", { userId: "dee" }, { day: 1, week: 1, month: 4 });
    expect(open).toMatchObject({ source: "none", limit: 0, used: 4, remaining: null, window: null });
  });

  it("assembles one row per requested member", async () => {
    const items = await loadUserQuotaOverview("tenant-a", ["ada", "bea", "cy"], deps(), new Date("2026-10-20T08:00:00.000Z"));
    expect(items.map((item) => item.budget.source)).toEqual(["user", "group", "default"]);
    expect(items[0]?.features.search_provider_calls.remaining).toBe(1);
    expect(items[1]?.budget.rule?.limit).toBe(500_000);
    expect(items[1]?.budget.used).toBe(12_000);
    expect(items[2]?.features.deep_research_runs.source).toBe("default");
  });

  it("summarizes each group's member count and per-member rules", async () => {
    const groups = await loadGroupLimitOverview("tenant-a", deps());
    expect(groups).toEqual([
      expect.objectContaining({
        id: "analysts",
        name: "分析组",
        memberCount: 1,
        spending: expect.objectContaining({ limit: 500_000, action: "block" }),
        search: { day: 0, week: 8, month: 0 },
      }),
    ]);
  });
});
