import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_SEARCH_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
  DAILY_SEARCH_PROVIDER_QUOTA_UNAVAILABLE_MESSAGE,
  MAX_DAILY_SEARCH_PROVIDER_CALLS,
  __createMemoryDailySearchProviderQuotaOps,
  __setDailySearchProviderQuotaOpsForTests,
  getTenantDailySearchProviderQuota,
  isTenantDailySearchProviderQuotaExceeded,
  isValidMaxDailySearchProviderCalls,
  reserveTenantDailySearchProviderCall,
  setTenantDailySearchProviderLimit,
  utcUsageDay,
} from "../daily-provider-quota";

type Ops = ReturnType<typeof __createMemoryDailySearchProviderQuotaOps>;

let ops: Ops;

beforeEach(() => {
  ops = __createMemoryDailySearchProviderQuotaOps();
  __setDailySearchProviderQuotaOpsForTests(ops);
});

afterEach(() => {
  __setDailySearchProviderQuotaOpsForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("daily search provider quota", () => {
  it("admits exactly `limit` of many concurrent reservations", async () => {
    await setTenantDailySearchProviderLimit("t1", 7);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveTenantDailySearchProviderCall("t1")),
    );
    const admitted = outcomes.filter((o) => o.status === "fulfilled").length;
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(admitted).toBe(7);
    expect(rejected).toHaveLength(13);
    expect(
      rejected.every((o) =>
        isTenantDailySearchProviderQuotaExceeded((o as PromiseRejectedResult).reason),
      ),
    ).toBe(true);
    await expect(getTenantDailySearchProviderQuota("t1")).resolves.toMatchObject({
      limit: 7,
      used: 7,
      remaining: 0,
      unlimited: false,
    });
  });

  it("counts every attempt, including the failover call", async () => {
    await setTenantDailySearchProviderLimit("t1", 10);
    // Primary attempt, then the fallback provider for the same query.
    await reserveTenantDailySearchProviderCall("t1");
    await reserveTenantDailySearchProviderCall("t1");
    await expect(getTenantDailySearchProviderQuota("t1")).resolves.toMatchObject({
      used: 2,
      remaining: 8,
    });
  });

  it("still accumulates real usage when unlimited", async () => {
    await reserveTenantDailySearchProviderCall("t1");
    await reserveTenantDailySearchProviderCall("t1");
    await expect(getTenantDailySearchProviderQuota("t1")).resolves.toEqual({
      usageDay: utcUsageDay(),
      limit: 0,
      used: 2,
      remaining: null,
      unlimited: true,
    });
  });

  it("resets on the UTC day boundary", async () => {
    const day1 = new Date("2026-08-14T23:59:59.000Z");
    const day2 = new Date("2026-08-15T00:00:01.000Z");
    await setTenantDailySearchProviderLimit("t1", 2, day1);
    await reserveTenantDailySearchProviderCall("t1", day1);
    await reserveTenantDailySearchProviderCall("t1", day1);
    await expect(reserveTenantDailySearchProviderCall("t1", day1)).rejects.toThrow();

    await reserveTenantDailySearchProviderCall("t1", day2);
    await expect(getTenantDailySearchProviderQuota("t1", day2)).resolves.toMatchObject({
      usageDay: "2026-08-15",
      used: 1,
      limit: 2,
    });
  });

  it("lowering the limit never clears today's usage and blocks immediately", async () => {
    await setTenantDailySearchProviderLimit("t1", 10);
    for (let i = 0; i < 5; i += 1) await reserveTenantDailySearchProviderCall("t1");

    await expect(setTenantDailySearchProviderLimit("t1", 3)).resolves.toMatchObject({
      limit: 3,
      used: 5,
      remaining: 0,
    });
    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toThrow(
      /quota exhausted/,
    );
  });

  it("raising the limit re-opens the gate without resetting usage", async () => {
    await setTenantDailySearchProviderLimit("t1", 1);
    await reserveTenantDailySearchProviderCall("t1");
    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toThrow();

    await setTenantDailySearchProviderLimit("t1", 3);
    await reserveTenantDailySearchProviderCall("t1");
    await expect(getTenantDailySearchProviderQuota("t1")).resolves.toMatchObject({
      limit: 3,
      used: 2,
      remaining: 1,
    });
  });

  it("keeps tenants isolated", async () => {
    await setTenantDailySearchProviderLimit("t1", 1);
    await reserveTenantDailySearchProviderCall("t1");
    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toThrow();
    await expect(reserveTenantDailySearchProviderCall("t2")).resolves.toBeUndefined();
  });

  it("fails closed when the quota store is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(ops, "reserve").mockRejectedValue(new Error("connection refused"));

    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("fails closed when production starts without a database", async () => {
    __setDailySearchProviderQuotaOpsForTests(null);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toMatchObject({
      reason: "unavailable",
      userMessage: DAILY_SEARCH_PROVIDER_QUOTA_UNAVAILABLE_MESSAGE,
    });
  });

  it("keeps the no-database memory store limited to local development", async () => {
    __setDailySearchProviderQuotaOpsForTests(null);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");

    await reserveTenantDailySearchProviderCall("local-tenant");
    await expect(getTenantDailySearchProviderQuota("local-tenant")).resolves.toMatchObject({
      used: 1,
      unlimited: true,
    });
  });

  it("carries the operator-facing message on exhaustion", async () => {
    await setTenantDailySearchProviderLimit("t1", 0 + 1);
    await reserveTenantDailySearchProviderCall("t1");
    await expect(reserveTenantDailySearchProviderCall("t1")).rejects.toMatchObject({
      reason: "exhausted",
      userMessage: DAILY_SEARCH_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
    });
  });

  it("validates the admin-editable range", () => {
    expect(isValidMaxDailySearchProviderCalls(0)).toBe(true);
    expect(isValidMaxDailySearchProviderCalls(MAX_DAILY_SEARCH_PROVIDER_CALLS)).toBe(true);
    expect(isValidMaxDailySearchProviderCalls(MAX_DAILY_SEARCH_PROVIDER_CALLS + 1)).toBe(false);
    expect(isValidMaxDailySearchProviderCalls(-1)).toBe(false);
    expect(isValidMaxDailySearchProviderCalls(1.5)).toBe(false);
    expect(isValidMaxDailySearchProviderCalls("10")).toBe(false);
    expect(isValidMaxDailySearchProviderCalls(Number.NaN)).toBe(false);
  });

  it("rejects an out-of-range limit instead of persisting it", async () => {
    await expect(setTenantDailySearchProviderLimit("t1", -1)).rejects.toBeInstanceOf(RangeError);
    await expect(getTenantDailySearchProviderQuota("t1")).resolves.toMatchObject({ limit: 0 });
  });
});
