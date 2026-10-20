import { describe, expect, it } from "vitest";
import { memberSpendingRules, type MemberSpendingRule } from "../member-spending-limit";

const personal: MemberSpendingRule = { unit: "tokens", period: "month", limit: 50_000_000, action: "block" };

describe("memberSpendingRules", () => {
  it("prefers a personal exception over group rules and the per-person default", () => {
    const config = {
      defaults: { ...personal, limit: 10 },
      groups: { g: { ...personal, limit: 20 } },
      users: { old: { ...personal, limit: 30 } },
      userGroups: { u: ["g"], old: ["g"] },
    };
    expect(memberSpendingRules(config, { userId: "old" })).toEqual({
      source: "user",
      rules: [{ ...personal, limit: 30 }],
    });
    expect(memberSpendingRules(config, { userId: "u" })).toEqual({
      source: "group",
      rules: [{ ...personal, limit: 20, action: "block" }],
    });
  });

  it("keeps the strictest group rule per unit and period and blocks when that rule applies", () => {
    const config = {
      groups: {
        a: { ...personal, limit: 100, action: "warn" as const },
        b: { ...personal, limit: 60 },
        c: { ...personal, period: "day" as const, limit: 8 },
        d: { ...personal, unit: "cost_usd" as const, limit: 3 },
      },
      userGroups: { u: ["a", "b", "c", "d", "d"] },
    };
    expect(memberSpendingRules(config, { userId: "u" })).toEqual({
      source: "group",
      rules: [
        { ...personal, unit: "cost_usd", period: "month", limit: 3, action: "block" },
        { ...personal, unit: "tokens", period: "day", limit: 8, action: "block" },
        { ...personal, unit: "tokens", period: "month", limit: 60, action: "block" },
      ],
    });
  });

  it("falls back to the per-person default when the member has no exception and no positive group rule", () => {
    expect(memberSpendingRules({ defaults: personal, groups: { g: { ...personal, limit: 0 } }, userGroups: { u: ["g"] } }, { userId: "u" })).toEqual({
      source: "default",
      rules: [personal],
    });
    expect(
      memberSpendingRules({ defaults: personal, users: { u: { ...personal, limit: 0 } } }, { userId: "u" }),
    ).toEqual({ source: "default", rules: [personal] });
  });

  it("returns none when no personal layer is configured", () => {
    expect(memberSpendingRules(undefined, { userId: "u" })).toEqual({ source: "none", rules: [] });
    expect(
      memberSpendingRules(
        { defaults: { ...personal, limit: 0 }, users: { u: { ...personal, limit: 0 } } },
        { userId: "u" },
      ),
    ).toEqual({ source: "none", rules: [] });
  });
});
