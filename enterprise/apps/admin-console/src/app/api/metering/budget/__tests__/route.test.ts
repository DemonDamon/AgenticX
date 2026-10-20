import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  getBudgetConfig: vi.fn(),
  setBudgetConfig: vi.fn(),
  listBudgetAlerts: vi.fn(),
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../lib/budget-store", async () => {
  const actual = await vi.importActual<typeof import("../../../../../lib/budget-store")>("../../../../../lib/budget-store");
  return {
    ...actual,
    getBudgetConfig: (...args: unknown[]) => mocks.getBudgetConfig(...args),
    setBudgetConfig: (...args: unknown[]) => mocks.setBudgetConfig(...args),
    listBudgetAlerts: (...args: unknown[]) => mocks.listBudgetAlerts(...args),
  };
});

import { BudgetConflictError } from "../../../../../lib/budget-store";

const STORED_AT = "2026-10-20T00:00:00.000Z";
const originalTenant = process.env.DEFAULT_TENANT_ID;

const stored = {
  version: 2 as const,
  updatedAt: STORED_AT,
  companyLimits: { tokens: 10, costUsd: 1 },
  defaults: { unit: "tokens" as const, period: "week" as const, limit: 7, warnThresholdPct: 80, action: "warn" as const },
  tenants: { "tenant-a": { unit: "tokens" as const, period: "month" as const, limit: 9, warnThresholdPct: 80, action: "block" as const } },
  departments: { research: { unit: "tokens" as const, period: "day" as const, limit: 3, warnThresholdPct: 80, action: "block" as const } },
  groups: { analysts: { unit: "tokens" as const, period: "month" as const, limit: 4, warnThresholdPct: 80, action: "warn" as const } },
  users: { analyst: { unit: "cost_usd" as const, period: "month" as const, limit: 2, warnThresholdPct: 80, action: "fallback" as const, fallbackModel: "economy" } },
};

describe("/api/metering/budget", () => {
  beforeEach(() => {
    mocks.requireAdminScope.mockReset();
    mocks.getBudgetConfig.mockReset();
    mocks.setBudgetConfig.mockReset();
    mocks.listBudgetAlerts.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant-a";
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a", email: "admin@example.com" },
    });
    mocks.getBudgetConfig.mockResolvedValue(stored);
    mocks.setBudgetConfig.mockImplementation(async (value) => value);
    mocks.listBudgetAlerts.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalTenant === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalTenant;
  });

  it("returns the budget and the tenant the organization pool is stored under", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example.com/api/metering/budget"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: { tenantId: "tenant-a", budget: { version: 2 } },
    });
  });

  it("merges a partial update and leaves fields the caller did not send", async () => {
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: STORED_AT,
          companyLimits: { tokens: 20, costUsd: 0 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.setBudgetConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        companyLimits: { tokens: 20, costUsd: 0 },
        defaults: expect.objectContaining({ period: "week", limit: 7 }),
        tenants: { "tenant-a": expect.objectContaining({ limit: 9 }) },
        departments: { research: expect.objectContaining({ limit: 3 }) },
        groups: { analysts: expect.objectContaining({ limit: 4 }) },
        users: { analyst: expect.objectContaining({ limit: 2, fallbackModel: "economy" }) },
      }),
      { expectedUpdatedAt: STORED_AT },
    );
  });

  it("returns 409 when the stored budget changed since the caller loaded it", async () => {
    mocks.setBudgetConfig.mockRejectedValueOnce(new BudgetConflictError());
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: "2026-10-19T00:00:00.000Z",
          defaults: { unit: "tokens", period: "week", limit: 10, action: "warn" },
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "40900",
      message: "预算刚被其他管理员修改，请刷新后重试",
    });
  });
});
