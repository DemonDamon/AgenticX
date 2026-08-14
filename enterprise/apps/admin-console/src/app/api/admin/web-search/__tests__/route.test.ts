import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScope = vi.fn();
const getPublicWebSearchConfig = vi.fn();
const upsertTenantWebSearchConfig = vi.fn();
const getTenantDailySearchProviderQuota = vi.fn();
const setTenantDailySearchProviderLimit = vi.fn();
const WebSearchConfigValidationError = vi.hoisted(
  () => class WebSearchConfigValidationError extends Error {},
);

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScope(...args),
}));

vi.mock("../../../../../../../web-portal/src/lib/web-search/tenant-config", () => ({
  getPublicWebSearchConfig: (...args: unknown[]) => getPublicWebSearchConfig(...args),
  upsertTenantWebSearchConfig: (...args: unknown[]) => upsertTenantWebSearchConfig(...args),
  WebSearchConfigValidationError,
}));

vi.mock("../../../../../../../web-portal/src/lib/web-search/daily-provider-quota", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../../../web-portal/src/lib/web-search/daily-provider-quota")
  >("../../../../../../../web-portal/src/lib/web-search/daily-provider-quota");
  return {
    ...actual,
    getTenantDailySearchProviderQuota: (...args: unknown[]) =>
      getTenantDailySearchProviderQuota(...args),
    setTenantDailySearchProviderLimit: (...args: unknown[]) =>
      setTenantDailySearchProviderLimit(...args),
  };
});

import { GET, PUT } from "../route";

function put(body: unknown): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/admin/web-search", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const UNLIMITED_QUOTA = {
  usageDay: "2026-08-15",
  limit: 0,
  used: 0,
  remaining: null,
  unlimited: true,
};

describe("/api/admin/web-search", () => {
  beforeEach(() => {
    requireAdminScope.mockReset();
    getPublicWebSearchConfig.mockReset();
    upsertTenantWebSearchConfig.mockReset();
    getTenantDailySearchProviderQuota.mockReset();
    setTenantDailySearchProviderLimit.mockReset();
    getTenantDailySearchProviderQuota.mockResolvedValue(UNLIMITED_QUOTA);
    setTenantDailySearchProviderLimit.mockResolvedValue(UNLIMITED_QUOTA);
    requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", userId: "admin-1" },
    });
  });

  it("loads tenant search configuration with read scope", async () => {
    getPublicWebSearchConfig.mockResolvedValue({ maxSearchCalls: 4 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(requireAdminScope).toHaveBeenCalledWith(["provider:read"]);
    expect(getPublicWebSearchConfig).toHaveBeenCalledWith("tenant-1");
  });

  it("persists the bounded per-turn search limit with update scope", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls: 5 });

    const response = await put({ maxSearchCalls: 5 });

    expect(response.status).toBe(200);
    expect(requireAdminScope).toHaveBeenCalledWith(["provider:update"]);
    expect(upsertTenantWebSearchConfig).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ maxSearchCalls: 5 }),
    );
  });

  it.each([0, 6, 1.5, "3", null])(
    "rejects invalid search limits: %s",
    async (maxSearchCalls) => {
      const response = await put({ maxSearchCalls });
      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
    },
  );

  it("persists an independent deep-research provider-call limit", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({
      maxDeepResearchProviderCalls: 24,
    });

    const response = await put({ maxDeepResearchProviderCalls: 24 });

    expect(response.status).toBe(200);
    expect(upsertTenantWebSearchConfig).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ maxDeepResearchProviderCalls: 24 }),
    );
  });

  it.each([5, 61, 12.5, "24", null])(
    "rejects invalid deep-research provider limits: %s",
    async (maxDeepResearchProviderCalls) => {
      const response = await put({ maxDeepResearchProviderCalls });
      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
    },
  );

  it("exposes today's provider usage alongside the tenant policy", async () => {
    getPublicWebSearchConfig.mockResolvedValue({ maxSearchCalls: 4 });
    getTenantDailySearchProviderQuota.mockResolvedValue({
      usageDay: "2026-08-15",
      limit: 1000,
      used: 237,
      remaining: 763,
      unlimited: false,
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      data: {
        maxSearchCalls: 4,
        dailyProviderQuota: { usageDay: "2026-08-15", limit: 1000, used: 237, remaining: 763 },
      },
    });
    expect(getTenantDailySearchProviderQuota).toHaveBeenCalledWith("tenant-1");
  });

  it("persists only the daily limit and reports the untouched counter", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls: 4 });
    getTenantDailySearchProviderQuota.mockResolvedValue({
      usageDay: "2026-08-15",
      limit: 3,
      used: 5,
      remaining: 0,
      unlimited: false,
    });

    const response = await put({ maxDailySearchProviderCalls: 3 });

    expect(response.status).toBe(200);
    expect(setTenantDailySearchProviderLimit).toHaveBeenCalledWith("tenant-1", 3);
    // Lowering the cap must not reset what the tenant already spent today.
    await expect(response.json()).resolves.toMatchObject({
      data: { dailyProviderQuota: { limit: 3, used: 5, remaining: 0 } },
    });
  });

  it.each([-1, 1_000_001, 2.5, "100", null])(
    "rejects invalid daily provider limits: %s",
    async (maxDailySearchProviderCalls) => {
      const response = await put({ maxDailySearchProviderCalls });
      expect(response.status).toBe(400);
      expect(upsertTenantWebSearchConfig).not.toHaveBeenCalled();
      expect(setTenantDailySearchProviderLimit).not.toHaveBeenCalled();
    },
  );

  it("leaves the daily limit alone when the payload omits it", async () => {
    upsertTenantWebSearchConfig.mockResolvedValue({ maxSearchCalls: 5 });
    await put({ maxSearchCalls: 5 });
    expect(setTenantDailySearchProviderLimit).not.toHaveBeenCalled();
  });

  it("does not load configuration when the admin guard rejects access", async () => {
    requireAdminScope.mockResolvedValue({
      ok: false,
      response: Response.json({ code: "40300" }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(getPublicWebSearchConfig).not.toHaveBeenCalled();
  });
});
