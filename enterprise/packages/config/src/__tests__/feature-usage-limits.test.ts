import { describe, expect, it } from "vitest";

import {
  featureUsageDayRange,
  featureUsageState,
  NO_FEATURE_USAGE_LIMITS,
  normalizeFeatureUsageLimit,
  resolveFeatureUsageLimits,
  resolveFeatureUsagePolicies,
  utcUsageDay,
  type FeatureUsageConfig,
} from "../feature-usage-limits";

const CONFIG: FeatureUsageConfig = {
  defaults: {
    role: {
      staff: { searchCallsPerDay: 200, deepResearchRunsPerDay: 3 },
      admin: { searchCallsPerDay: 1000, deepResearchRunsPerDay: 20 },
      auditor: { deepResearchRunsPerDay: 8 },
    },
  },
  company: { searchCallsPerDay: 5000, deepResearchRunsPerDay: 100 },
  departments: {
    "dept-research": { searchCallsPerDay: 800, deepResearchRunsPerDay: 10 },
  },
  groups: {
    "group-a": { searchCallsPerDay: 90, deepResearchRunsPerWeek: 7 },
    "group-b": { searchCallsPerWeek: 100, deepResearchRunsPerWeek: 5 },
  },
  users: {
    "user-vip": { deepResearchRunsPerDay: 50 },
  },
};

describe("resolveFeatureUsageLimits", () => {
  it("gives a member the default for their role", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG, "deep_research_runs", { userId: "u1", roles: ["member"] }),
    ).toEqual({ limits: { day: 3, week: 0, month: 0 }, source: "default" });
  });

  it("falls back to the catch-all for a member with no roles", () => {
    const resolved = resolveFeatureUsageLimits(CONFIG, "search_provider_calls", { userId: "u1" });
    expect(resolved).toEqual({ limits: { day: 200, week: 0, month: 0 }, source: "default" });
  });

  it("keeps department and company limits independent of the personal default", () => {
    expect(
      resolveFeatureUsagePolicies(CONFIG, "deep_research_runs", {
        userId: "u1",
        deptId: "dept-research",
        roles: ["member"],
      }),
    ).toEqual({
      personal: { limits: { day: 3, week: 0, month: 0 }, source: "default" },
      department: { limits: { day: 10, week: 0, month: 0 }, source: "department" },
      company: { limits: { day: 100, week: 0, month: 0 }, source: "company" },
    });
  });

  it("keeps the default for a department that has no rule of its own", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG, "deep_research_runs", {
        userId: "u1",
        deptId: "dept-sales",
        roles: ["member"],
      }).source,
    ).toBe("default");
  });

  it("lets a personal exception outrank both", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG, "deep_research_runs", {
        userId: "user-vip",
        deptId: "dept-research",
        roles: ["member"],
      }),
    ).toEqual({ limits: { day: 50, week: 0, month: 0 }, source: "user" });
  });

  /**
   * The personal exception above names only deep research. Search has to fall
   * through to a group/default; its department pool still applies separately.
   */
  it("falls through per feature, not per member", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG, "search_provider_calls", {
        userId: "user-vip",
        deptId: "dept-research",
        roles: ["member"],
      }),
    ).toEqual({ limits: { day: 200, week: 0, month: 0 }, source: "default" });
  });

  it("takes the strictest configured group window and keeps a personal exception above it", () => {
    expect(resolveFeatureUsageLimits(CONFIG, "deep_research_runs", {
      userId: "u1", groupIds: ["group-a", "group-b"],
    })).toEqual({ limits: { day: 0, week: 5, month: 0 }, source: "group" });
    expect(resolveFeatureUsageLimits(CONFIG, "search_provider_calls", {
      userId: "u1", groupIds: ["group-a", "group-b"],
    })).toEqual({ limits: { day: 90, week: 100, month: 0 }, source: "group" });
    expect(resolveFeatureUsageLimits(CONFIG, "deep_research_runs", {
      userId: "user-vip", groupIds: ["group-a", "group-b"],
    }).source).toBe("user");
  });

  it("answers no ceiling when nothing is configured", () => {
    expect(resolveFeatureUsageLimits({}, "search_provider_calls", { userId: "u1" })).toEqual({
      limits: NO_FEATURE_USAGE_LIMITS,
      source: "none",
    });
    expect(
      resolveFeatureUsageLimits(undefined, "deep_research_runs", { userId: "u1" }).source,
    ).toBe("none");
  });

  /**
   * The winning layer answers every window. Merging them would let a member
   * carry a daily cap from a group and a monthly cap from the tenant
   * default, and nobody could say afterwards which number stopped them.
   */
  it("does not merge windows across layers", () => {
    const config: FeatureUsageConfig = {
      defaults: { role: { staff: { deepResearchRunsPerMonth: 100 } } },
      groups: { g1: { deepResearchRunsPerDay: 5 } },
    };
    expect(
      resolveFeatureUsageLimits(config, "deep_research_runs", {
        userId: "u1",
        groupIds: ["g1"],
        roles: ["member"],
      }),
    ).toEqual({ limits: { day: 5, week: 0, month: 0 }, source: "group" });
  });

  it("ignores a rule that only zeroes things out", () => {
    const config: FeatureUsageConfig = {
      defaults: { role: { staff: { deepResearchRunsPerDay: 3 } } },
      groups: { g1: { deepResearchRunsPerDay: 0, deepResearchRunsPerWeek: -5 } },
    };
    expect(
      resolveFeatureUsageLimits(config, "deep_research_runs", {
        userId: "u1",
        groupIds: ["g1"],
        roles: ["member"],
      }).source,
    ).toBe("default");
  });
});

describe("normalizeFeatureUsageLimit", () => {
  it("keeps only positive whole numbers", () => {
    expect(normalizeFeatureUsageLimit("12")).toBe(12);
    expect(normalizeFeatureUsageLimit(7.9)).toBe(7);
    expect(normalizeFeatureUsageLimit(0)).toBe(0);
    expect(normalizeFeatureUsageLimit(-3)).toBe(0);
    expect(normalizeFeatureUsageLimit("abc")).toBe(0);
    expect(normalizeFeatureUsageLimit(undefined)).toBe(0);
  });
});

describe("featureUsageDayRange", () => {
  // 2026-09-21 is a Monday, so the ISO week starts on the day itself.
  const monday = new Date("2026-09-21T09:30:00.000Z");
  const sunday = new Date("2026-09-27T23:59:00.000Z");

  it("covers one day, the ISO week and the calendar month", () => {
    expect(featureUsageDayRange("day", monday)).toEqual({
      fromDay: "2026-09-21",
      toDay: "2026-09-21",
    });
    expect(featureUsageDayRange("week", monday)).toEqual({
      fromDay: "2026-09-21",
      toDay: "2026-09-21",
    });
    expect(featureUsageDayRange("month", monday)).toEqual({
      fromDay: "2026-09-01",
      toDay: "2026-09-21",
    });
  });

  it("keeps Sunday in the week that started on Monday", () => {
    expect(featureUsageDayRange("week", sunday)).toEqual({
      fromDay: "2026-09-21",
      toDay: "2026-09-27",
    });
  });

  it("does not let a week that crosses a month boundary lose its earlier days", () => {
    // 2026-10-01 is a Thursday; its ISO week began on 2026-09-28.
    const thursday = new Date("2026-10-01T00:10:00.000Z");
    expect(featureUsageDayRange("week", thursday)).toEqual({
      fromDay: "2026-09-28",
      toDay: "2026-10-01",
    });
  });

  it("reads the day in UTC, matching the stored counter key", () => {
    expect(utcUsageDay(new Date("2026-09-21T23:59:59.000Z"))).toBe("2026-09-21");
  });
});

describe("featureUsageState", () => {
  it("reports the window with the least headroom as the binding one", () => {
    const state = featureUsageState(
      "deep_research_runs",
      { limits: { day: 3, week: 0, month: 20 }, source: "default" },
      { day: 1, week: 0, month: 18 },
    );

    expect(state.unlimited).toBe(false);
    expect(state.windows).toEqual([
      { window: "day", limit: 3, used: 1, remaining: 2 },
      { window: "month", limit: 20, used: 18, remaining: 2 },
    ]);
    // A tie keeps the first, so the member is told about the shorter window.
    expect(state.binding?.window).toBe("day");
  });

  it("picks the month when it is the tighter one", () => {
    const state = featureUsageState(
      "deep_research_runs",
      { limits: { day: 3, week: 0, month: 20 }, source: "default" },
      { day: 0, week: 0, month: 19 },
    );
    expect(state.binding).toEqual({ window: "month", limit: 20, used: 19, remaining: 1 });
  });

  it("never reports negative headroom after an overshoot", () => {
    const state = featureUsageState(
      "search_provider_calls",
      { limits: { day: 10, week: 0, month: 0 }, source: "user" },
      { day: 14, week: 0, month: 0 },
    );
    expect(state.binding).toEqual({ window: "day", limit: 10, used: 14, remaining: 0 });
  });

  it("says unlimited when the member has no ceiling at all", () => {
    const state = featureUsageState(
      "search_provider_calls",
      { limits: NO_FEATURE_USAGE_LIMITS, source: "none" },
      { day: 999, week: 999, month: 999 },
    );
    expect(state.unlimited).toBe(true);
    expect(state.windows).toEqual([]);
    expect(state.binding).toBeNull();
  });
});

describe("role precedence", () => {
  const CONFIG_WITH_ROLES: FeatureUsageConfig = {
    defaults: {
      role: {
        staff: { deepResearchRunsPerDay: 3 },
        admin: { deepResearchRunsPerDay: 20 },
        auditor: { deepResearchRunsPerDay: 8 },
      },
    },
  };

  it("uses the rule for the role the member actually holds", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG_WITH_ROLES, "deep_research_runs", {
        userId: "u1",
        roles: ["auditor"],
      }).limits.day,
    ).toBe(8);
  });

  /**
   * Several roles have to resolve to one answer. Highest privilege wins,
   * because comparing "generous daily" against "generous monthly" has no
   * obvious answer and an administrator could not predict either.
   */
  it("takes the highest-privileged role when a member holds several", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG_WITH_ROLES, "deep_research_runs", {
        userId: "u1",
        roles: ["auditor", "admin", "member"],
      }).limits.day,
    ).toBe(20);
  });

  it("skips a held role that has no rule and keeps looking down the order", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG_WITH_ROLES, "deep_research_runs", {
        userId: "u1",
        roles: ["owner", "auditor"],
      }).limits.day,
    ).toBe(8);
  });

  it("falls back to the catch-all when none of the member's roles has a rule", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG_WITH_ROLES, "deep_research_runs", {
        userId: "u1",
        roles: ["policy_publisher"],
      }),
    ).toEqual({ limits: { day: 3, week: 0, month: 0 }, source: "default" });
  });

  it("ignores casing and padding in the stored role codes", () => {
    expect(
      resolveFeatureUsageLimits(CONFIG_WITH_ROLES, "deep_research_runs", {
        userId: "u1",
        roles: ["  Admin  "],
      }).limits.day,
    ).toBe(20);
  });

  /** Shared department cap does not replace the personal default. */
  it("keeps the department separate from the role default", () => {
    expect(
      resolveFeatureUsagePolicies(
        { ...CONFIG_WITH_ROLES, departments: { d1: { deepResearchRunsPerDay: 5 } } },
        "deep_research_runs",
        { userId: "u1", deptId: "d1", roles: ["admin"] },
      ).personal,
    ).toEqual({ limits: { day: 20, week: 0, month: 0 }, source: "default" });
  });
});
