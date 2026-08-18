import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  getQuotaConfig: vi.fn(),
  setQuotaConfig: vi.fn(),
  quotaFilePath: vi.fn(() => "/runtime/quotas.json"),
  QuotaConfigConflictError: class QuotaConfigConflictError extends Error {},
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../lib/token-quota-store", () => ({
  getQuotaConfig: (...args: unknown[]) => mocks.getQuotaConfig(...args),
  setQuotaConfig: (...args: unknown[]) => mocks.setQuotaConfig(...args),
  quotaFilePath: () => mocks.quotaFilePath(),
  QuotaConfigConflictError: mocks.QuotaConfigConflictError,
}));

const tenantA = {
  defaults: { role: { staff: { monthlyTokens: 100, action: "block" } }, model: {} },
  users: {},
  departments: {},
  updatedAt: "2026-08-18T00:00:00.000Z",
};
const tenantB = {
  defaults: { role: { staff: { monthlyTokens: 200, action: "block" } }, model: {} },
  users: {},
  departments: {},
  updatedAt: "2026-08-18T00:00:00.000Z",
};

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe("/api/metering/quota tenant isolation", () => {
  beforeEach(() => {
    mocks.requireAdminScope.mockReset();
    mocks.getQuotaConfig.mockReset();
    mocks.setQuotaConfig.mockReset();
    mocks.quotaFilePath.mockClear();
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) {
      delete process.env.DEFAULT_TENANT_ID;
    } else {
      process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
    }
  });

  it("reads quota config using the authenticated tenant", async () => {
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    mocks.getQuotaConfig.mockResolvedValue(tenantA);

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["metering:read"]);
    expect(mocks.getQuotaConfig).toHaveBeenCalledWith("tenant-a");
  });

  it("writes quota config using the authenticated tenant", async () => {
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-b", userId: "admin-b" },
    });
    mocks.setQuotaConfig.mockResolvedValue(tenantB);

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: tenantB.updatedAt,
          defaults: tenantB.defaults,
          users: tenantB.users,
          departments: tenantB.departments,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["metering:manage"]);
    expect(mocks.setQuotaConfig).toHaveBeenCalledWith(
      {
        defaults: tenantB.defaults,
        users: tenantB.users,
        departments: tenantB.departments,
      },
      "tenant-b",
      tenantB.updatedAt,
    );
  });

  it("never substitutes the process default tenant across two admin sessions", async () => {
    process.env.DEFAULT_TENANT_ID = "tenant-default";
    const rows = new Map<string, unknown>();
    mocks.setQuotaConfig.mockImplementation(async (value, tenantId, expectedUpdatedAt) => {
      const stored = { ...value, updatedAt: expectedUpdatedAt };
      rows.set(String(tenantId), stored);
      return stored;
    });
    mocks.getQuotaConfig.mockImplementation(async (tenantId) => rows.get(String(tenantId)));
    mocks.requireAdminScope
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-a", userId: "admin-a" } })
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-b", userId: "admin-b" } })
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-a", userId: "admin-a" } })
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-b", userId: "admin-b" } });

    const { GET, PUT } = await import("../route");
    await PUT(
      new Request("https://admin.example.com/api/metering/quota", {
        method: "PUT",
        body: JSON.stringify({ ...tenantA, expectedUpdatedAt: tenantA.updatedAt, updatedAt: undefined }),
      }),
    );
    await PUT(
      new Request("https://admin.example.com/api/metering/quota", {
        method: "PUT",
        body: JSON.stringify({ ...tenantB, expectedUpdatedAt: tenantB.updatedAt, updatedAt: undefined }),
      }),
    );
    const responseA = await GET();
    const responseB = await GET();

    await expect(responseA.json()).resolves.toMatchObject({ data: { quota: tenantA } });
    await expect(responseB.json()).resolves.toMatchObject({ data: { quota: tenantB } });
    expect(rows.has("tenant-default")).toBe(false);
  });

  it("returns 409 when another administrator saved the quota first", async () => {
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    mocks.setQuotaConfig.mockRejectedValue(new mocks.QuotaConfigConflictError());

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/quota", {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: tenantA.updatedAt,
          users: tenantA.users,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "40901" });
  });

  it("requires an explicit version for quota patches", async () => {
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });

    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/quota", {
        method: "PUT",
        body: JSON.stringify({ users: {} }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.setQuotaConfig).not.toHaveBeenCalled();
  });
});
