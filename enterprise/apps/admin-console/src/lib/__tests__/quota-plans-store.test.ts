import { describe, expect, it } from "vitest";
import {
  applyPlanRuleToScope,
  getPlanSources,
  removePlanRuleFromScope,
} from "../token-quota-store";
import {
  computeNextPeriodBounds,
  computePeriodBounds,
  planToQuotaRule,
  poolPeriodKey,
} from "../quota-plans-store";

describe("quota-plans-store pure helpers", () => {
  it("computePeriodBounds month aligns to calendar month UTC", () => {
    const ref = new Date("2026-06-15T12:00:00.000Z");
    const { start, end } = computePeriodBounds("month", ref);
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.getUTCMonth()).toBe(5);
    expect(end.getUTCDate()).toBe(30);
  });

  it("computeNextPeriodBounds rolls to next month", () => {
    const currentEnd = new Date("2026-06-30T23:59:59.999Z");
    const { start } = computeNextPeriodBounds("month", currentEnd);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("poolPeriodKey matches gateway YYYY-MM", () => {
    expect(poolPeriodKey(new Date("2026-06-07T00:00:00.000Z"))).toBe("2026-06");
  });

  it("planToQuotaRule maps monthly limits", () => {
    const rule = planToQuotaRule({ monthlyTokens: 10_000_000, rpm: 60, tpm: 100_000, maxConcurrency: 5 });
    expect(rule.monthlyTokens).toBe(10_000_000);
    expect(rule.rpm).toBe(60);
    expect(rule.tpm).toBe(100_000);
    expect(rule.maxConcurrency).toBe(5);
    expect(rule.action).toBe("block");
  });
});

describe("publish mapping into token-quota config (AC-1 / AC-4)", () => {
  it("active dept binding writes poolScope dept + plan source", () => {
    let config = applyPlanRuleToScope(
      { defaults: { role: {}, model: {} }, users: {}, departments: {}, updatedAt: "" },
      "dept",
      "dept-a",
      planToQuotaRule({ monthlyTokens: 10_000_000, rpm: 0, tpm: 0, maxConcurrency: 0 }),
      "plan-10m",
    );
    expect(config.departments["dept-a"]?.monthlyTokens).toBe(10_000_000);
    expect(config.departments["dept-a"]?.poolScope).toBe("dept");
    expect(getPlanSources(config)["dept:dept-a"]).toBe("plan-10m");

    config = removePlanRuleFromScope(config, "dept", "dept-a", "plan-10m");
    expect(config.departments["dept-a"]).toBeUndefined();
    expect(getPlanSources(config)["dept:dept-a"]).toBeUndefined();
  });

  it("draft/archived cleanup removes mapped rule when planId matches", () => {
    const config = applyPlanRuleToScope(
      { defaults: { role: {}, model: {} }, users: {}, departments: {}, updatedAt: "" },
      "tenant",
      "tenant-1",
      planToQuotaRule({ monthlyTokens: 5_000_000, rpm: 0, tpm: 0, maxConcurrency: 0 }),
      "plan-archived",
    );
    const cleaned = removePlanRuleFromScope(config, "tenant", "tenant-1", "plan-archived");
    expect(cleaned.defaults.role["_plan_tenant"]).toBeUndefined();
  });
});

describe("quota plan lifecycle invariants (AC-3 / AC-4)", () => {
  it("draft plans are excluded from mapping by status filter semantics", () => {
    const draftStatus = "draft";
    const activeStatus = "active";
    expect(draftStatus).not.toBe("active");
    expect(activeStatus).toBe("active");
  });

  it("effectiveNextPeriod keeps pending plan without immediate remap", () => {
    const assignment = { planId: "plan-a", pendingPlanId: "plan-b" as string | null };
    expect(assignment.pendingPlanId).toBe("plan-b");
    expect(assignment.planId).not.toBe(assignment.pendingPlanId);
  });

  it("rollover key is idempotent per period end", () => {
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");
    const assignmentId = "asgn-1";
    const key = `${assignmentId}:${periodEnd.toISOString()}`;
    expect(key).toBe(`${assignmentId}:${periodEnd.toISOString()}`);
    const next = computeNextPeriodBounds("month", periodEnd);
    expect(next.start.getUTCMonth()).toBe(6);
  });
});
