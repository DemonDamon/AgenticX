import type { FeatureUsagePolicies } from "@agenticx/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __createMemoryFeatureUsageOps,
  __setFeatureUsageOpsForTests,
  readFeatureUsageTotals,
  readSharedFeatureUsageTotals,
  recordFeatureUsage,
  reserveFeatureUsage,
} from "../counters";
import { isFeatureUsageLimitError } from "../errors";

const TENANT = "t-1";
const NOW = new Date("2026-09-23T10:00:00.000Z");

const OPEN: FeatureUsagePolicies = {
  personal: { limits: { day: 0, week: 0, month: 0 }, source: "none" },
  department: { limits: { day: 0, week: 0, month: 0 }, source: "none" },
  company: { limits: { day: 0, week: 0, month: 0 }, source: "none" },
};

function policies(patch: Partial<{
  personal: Partial<FeatureUsagePolicies["personal"]["limits"]>;
  department: Partial<FeatureUsagePolicies["department"]["limits"]>;
  company: Partial<FeatureUsagePolicies["company"]["limits"]>;
}>): FeatureUsagePolicies {
  const layer = (
    limits: Partial<FeatureUsagePolicies["personal"]["limits"]> | undefined,
    source: FeatureUsagePolicies["personal"]["source"],
  ): FeatureUsagePolicies["personal"] => ({
    limits: { day: 0, week: 0, month: 0, ...limits },
    source: limits && Object.values(limits).some((value) => (value ?? 0) > 0) ? source : "none",
  });
  return {
    personal: layer(patch.personal, "user"),
    department: layer(patch.department, "department"),
    company: layer(patch.company, "company"),
  };
}

beforeEach(() => {
  __setFeatureUsageOpsForTests(__createMemoryFeatureUsageOps());
});

afterEach(() => {
  __setFeatureUsageOpsForTests(null);
});

describe("feature usage counters", () => {
  it("adds up a week and a month from the daily rows", async () => {
    const monday = new Date("2026-09-21T10:00:00.000Z");
    const wednesday = new Date("2026-09-23T10:00:00.000Z");
    const lastMonth = new Date("2026-08-30T10:00:00.000Z");

    for (const now of [monday, wednesday, lastMonth]) {
      await recordFeatureUsage({
        tenantId: TENANT,
        feature: "search_provider_calls",
        userId: "u-1",
        deptId: "d-1",
        now,
      });
    }

    const totals = await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      now: wednesday,
    });
    expect(totals.day).toBe(1);
    expect(totals.week).toBe(2);
    expect(totals.month).toBe(2);

    const company = await readSharedFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      scope: "company",
      scopeId: TENANT,
      now: wednesday,
    });
    expect(company.week).toBe(2);
    expect(company.month).toBe(2);
  });

  it("keeps the two features on separate counters", async () => {
    await recordFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      now: NOW,
    });
    const research = await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "deep_research_runs",
      userId: "u-1",
      now: NOW,
    });
    expect(research.day).toBe(0);
  });

  it("rejects the same member once their personal ceiling is full", async () => {
    const active = policies({ personal: { day: 1 } });
    const input = {
      tenantId: TENANT,
      feature: "search_provider_calls" as const,
      userId: "u-1",
      deptId: "d-1",
      policies: active,
      now: NOW,
    };
    await reserveFeatureUsage(input);
    const error = await reserveFeatureUsage(input).catch((caught: unknown) => caught);
    expect(isFeatureUsageLimitError(error)).toBe(true);
    expect((await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      now: NOW,
    })).day).toBe(1);
  });

  it.each([
    ["department", { department: { day: 1 } }],
    ["company", { company: { day: 1 } }],
  ] as const)("rejects another member when the %s pool is already full", async (_name, patch) => {
    const active = policies(patch);
    await reserveFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      deptId: "d-1",
      policies: active,
      now: NOW,
    });
    const error = await reserveFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-2",
      deptId: "d-1",
      policies: active,
      now: NOW,
    }).catch((caught: unknown) => caught);
    expect(isFeatureUsageLimitError(error)).toBe(true);
    if (!isFeatureUsageLimitError(error)) throw error;
    expect(error.source).toBe(_name);
  });

  it("does not let a personal exception bypass a shared cap", async () => {
    const active = policies({ personal: { day: 10 }, department: { day: 1 } });
    await reserveFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      deptId: "d-1",
      policies: active,
      now: NOW,
    });
    await expect(reserveFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      deptId: "d-1",
      policies: active,
      now: NOW,
    })).rejects.toThrow(/quota exhausted/);
  });

  it("increments personal, department and company together or not at all", async () => {
    const ops = __createMemoryFeatureUsageOps();
    __setFeatureUsageOpsForTests({
      ...ops,
      async incrementShared(input) {
        if (input.scope === "company" && input.delta > 0) throw new Error("company write failed");
        return ops.incrementShared(input);
      },
    });

    await expect(reserveFeatureUsage({
      tenantId: TENANT,
      feature: "deep_research_runs",
      userId: "u-1",
      deptId: "d-1",
      policies: policies({ personal: { day: 5 }, department: { day: 5 }, company: { day: 5 } }),
      now: NOW,
    })).rejects.toThrow(/company write failed/);

    expect((await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "deep_research_runs",
      userId: "u-1",
      now: NOW,
    })).day).toBe(0);
    expect((await readSharedFeatureUsageTotals({
      tenantId: TENANT,
      feature: "deep_research_runs",
      scope: "department",
      scopeId: "d-1",
      now: NOW,
    })).day).toBe(0);
    expect((await readSharedFeatureUsageTotals({
      tenantId: TENANT,
      feature: "deep_research_runs",
      scope: "company",
      scopeId: TENANT,
      now: NOW,
    })).day).toBe(0);
  });

  it("still counts an unlimited member so a later ceiling sees the history", async () => {
    await reserveFeatureUsage({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      deptId: "d-1",
      policies: OPEN,
      now: NOW,
    });
    expect((await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
      now: NOW,
    })).day).toBe(1);
  });
});
