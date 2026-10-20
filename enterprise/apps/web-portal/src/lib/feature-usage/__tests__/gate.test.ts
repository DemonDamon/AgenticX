import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { featureUsageConfigFromQuotaDocument } from "../config-reader";
import {
  __createMemoryFeatureUsageOps,
  __setFeatureUsageOpsForTests,
  readFeatureUsageTotals,
  readSharedFeatureUsageTotals,
  recordFeatureUsage,
} from "../counters";
import {
  admitFeatureUsage,
  countFeatureUsage,
  isFeatureUsageLimitError,
  readFeatureUsageState,
  reserveMemberSearchProviderCall,
  researchUsagePolicy,
} from "../gate";

const TENANT = "t-1";
const SUBJECT = { tenantId: TENANT, userId: "u-1", deptId: "d-1", roles: ["member"] };

const QUOTA_DOCUMENT = {
  featureUsage: {
    defaults: {
      role: {
        staff: { monthlyTokens: 600_000, action: "block", deepResearchRunsPerDay: 3 },
      },
    },
    departments: { "d-1": { monthlyTokens: 0, searchCallsPerDay: 5 } },
    users: {},
  },
  updatedAt: "2026-09-21T00:00:00.000Z",
};

const loadConfig = vi.hoisted(() => vi.fn());
const loadOrThrow = vi.hoisted(() => vi.fn());

vi.mock("../config-reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config-reader")>();
  return {
    ...actual,
    loadFeatureUsageConfigOrNone: loadConfig,
    loadFeatureUsageConfigOrThrow: loadOrThrow,
  };
});

beforeEach(() => {
  __setFeatureUsageOpsForTests(__createMemoryFeatureUsageOps());
  const config = featureUsageConfigFromQuotaDocument(QUOTA_DOCUMENT);
  loadConfig.mockResolvedValue({ config, readable: true });
  loadOrThrow.mockResolvedValue(config);
});

afterEach(() => {
  __setFeatureUsageOpsForTests(null);
  vi.restoreAllMocks();
});

describe("featureUsageConfigFromQuotaDocument", () => {
  it("lifts only the feature fields out of a full quota document", () => {
    expect(featureUsageConfigFromQuotaDocument(QUOTA_DOCUMENT)).toEqual({
      defaults: { role: { staff: { deepResearchRunsPerDay: 3 } } },
      company: {},
      departments: { "d-1": { searchCallsPerDay: 5 } },
      groups: {},
      users: {},
    });
  });

  it("drops a scope whose rule sets no feature ceiling at all", () => {
    const config = featureUsageConfigFromQuotaDocument({
      featureUsage: { departments: { "d-2": { monthlyTokens: 900, action: "block" } } },
    });
    expect(config.departments).toEqual({});
  });

  it("survives a missing or malformed document", () => {
    expect(featureUsageConfigFromQuotaDocument(undefined).departments).toEqual({});
    expect(featureUsageConfigFromQuotaDocument("nonsense").users).toEqual({});
    expect(featureUsageConfigFromQuotaDocument({ users: 42 }).users).toEqual({});
  });
});

describe("readFeatureUsageState", () => {
  it("reports the member's own ceiling and what they have spent", async () => {
    await recordFeatureUsage({ tenantId: TENANT, feature: "deep_research_runs", userId: "u-1" });

    const state = await readFeatureUsageState("deep_research_runs", SUBJECT);
    expect(state.unlimited).toBe(false);
    expect(state.source).toBe("default");
    expect(state.binding).toEqual({
      window: "day",
      limit: 3,
      used: 1,
      remaining: 2,
      source: "default",
    });
  });

  it("shows the binding department shared ceiling for search and the personal default for research", async () => {
    const search = await readFeatureUsageState("search_provider_calls", SUBJECT);
    expect(search.source).toBe("department");
    expect(search.binding?.limit).toBe(5);

    const research = await readFeatureUsageState("deep_research_runs", SUBJECT);
    expect(research.source).toBe("default");
    expect(research.binding?.limit).toBe(3);
  });

  it("counts one member's usage separately from another's", async () => {
    await recordFeatureUsage({ tenantId: TENANT, feature: "deep_research_runs", userId: "u-2" });
    const state = await readFeatureUsageState("deep_research_runs", SUBJECT);
    expect(state.binding?.used).toBe(0);
  });
});

describe("admitFeatureUsage", () => {
  it("admits while headroom is left and blocks once it is gone", async () => {
    await expect(admitFeatureUsage("deep_research_runs", SUBJECT)).resolves.toBeDefined();

    for (let i = 0; i < 3; i += 1) {
      await countFeatureUsage("deep_research_runs", SUBJECT);
    }

    const error = await admitFeatureUsage("deep_research_runs", SUBJECT).catch((caught: unknown) => caught);
    expect(isFeatureUsageLimitError(error)).toBe(true);
    if (!isFeatureUsageLimitError(error)) throw error;
    expect(error.window).toBe("day");
    expect(error.limit).toBe(3);
    expect(error.userMessage).toContain("今日深度研究次数已用完");
    expect(error.userMessage).toContain("3");
  });

  it("refuses search when configured ceilings cannot be read", async () => {
    loadConfig.mockResolvedValue({
      config: featureUsageConfigFromQuotaDocument({}),
      readable: false,
    });
    const state = await readFeatureUsageState("search_provider_calls", SUBJECT);
    expect(state).toMatchObject({ unavailable: true, unlimited: false });
    await expect(admitFeatureUsage("search_provider_calls", SUBJECT)).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
      userMessage: "暂时无法确认搜索次数，请稍后再试",
    });
  });

  it("refuses research when counters cannot be read", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    __setFeatureUsageOpsForTests({
      ...__createMemoryFeatureUsageOps(),
      sumSince: async () => {
        throw new Error("counter store down");
      },
    });

    const state = await readFeatureUsageState("deep_research_runs", SUBJECT);
    expect(state).toMatchObject({ unavailable: true, unlimited: false });
    await expect(admitFeatureUsage("deep_research_runs", SUBJECT)).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
    });
    expect(reported).toHaveBeenCalled();
  });

  it("reports a failed direct counter write as temporarily unavailable", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    __setFeatureUsageOpsForTests({
      ...__createMemoryFeatureUsageOps(),
      increment: async () => {
        throw new Error("counter store down");
      },
    });

    await expect(countFeatureUsage("deep_research_runs", SUBJECT)).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
      userMessage: "暂时无法确认研究次数，请稍后再试",
    });
    expect(reported).toHaveBeenCalled();
  });

  it("reserves one search call and stops at the department ceiling", async () => {
    await reserveMemberSearchProviderCall(SUBJECT);
    expect((await readFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      userId: "u-1",
    })).day).toBe(1);
    expect((await readSharedFeatureUsageTotals({
      tenantId: TENANT,
      feature: "search_provider_calls",
      scope: "department",
      scopeId: "d-1",
    })).day).toBe(1);

    for (let i = 0; i < 4; i += 1) {
      await reserveMemberSearchProviderCall({ ...SUBJECT, userId: `u-${i + 2}` });
    }
    await expect(reserveMemberSearchProviderCall({ ...SUBJECT, userId: "u-9" })).rejects.toMatchObject({
      name: "FeatureUsageLimitError",
      source: "department",
    });
  });

  it("throws when the quota document cannot be read for a reservation", async () => {
    loadOrThrow.mockRejectedValue(Object.assign(new Error("quota unavailable"), {
      name: "FeatureUsageUnavailableError",
    }));
    await expect(researchUsagePolicy(SUBJECT)).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
    });
    await expect(reserveMemberSearchProviderCall(SUBJECT)).rejects.toMatchObject({
      name: "FeatureUsageUnavailableError",
    });
  });
});
