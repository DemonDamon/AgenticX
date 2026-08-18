import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  getBudgetConfig: vi.fn(),
  setBudgetConfig: vi.fn(),
  listBudgetAlerts: vi.fn(),
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../lib/budget-store", () => ({
  getBudgetConfig: (...args: unknown[]) => mocks.getBudgetConfig(...args),
  setBudgetConfig: (...args: unknown[]) => mocks.setBudgetConfig(...args),
  listBudgetAlerts: (...args: unknown[]) => mocks.listBudgetAlerts(...args),
}));

describe("/api/metering/budget", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    mocks.getBudgetConfig.mockResolvedValue({
      updatedAt: "2026-08-18T00:00:00.000Z",
      sessionTokenLimits: {
        warningTokensPerSession: 500_000,
        maxTokensPerSession: 1_000_000,
      },
    });
    mocks.setBudgetConfig.mockImplementation(async (value) => value);
    mocks.listBudgetAlerts.mockResolvedValue([]);
  });

  it("reads the budget for the authenticated tenant", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example.com/api/metering/budget"));

    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["metering:read"]);
    expect(mocks.getBudgetConfig).toHaveBeenCalledWith("tenant-a");
  });

  it("saves valid session limits for the authenticated tenant", async () => {
    const limits = {
      warningTokensPerSession: 600_000,
      maxTokensPerSession: 1_200_000,
    };
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyLimits: { tokens: 2_000_000, costUsd: 100 },
          sessionTokenLimits: limits,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.setBudgetConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        companyLimits: { tokens: 2_000_000, costUsd: 100 },
        sessionTokenLimits: limits,
      }),
      "tenant-a",
    );
  });

  it.each([
    { warningTokensPerSession: 1_000_000, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: 1_100_000, maxTokensPerSession: 1_000_000 },
    { warningTokensPerSession: "500000", maxTokensPerSession: 1_000_000 },
  ])("rejects invalid session limits: %j", async (sessionTokenLimits) => {
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionTokenLimits }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.setBudgetConfig).not.toHaveBeenCalled();
  });

  it("scopes alert reads to the authenticated tenant", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/metering/budget?view=alerts&limit=25"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listBudgetAlerts).toHaveBeenCalledWith(25, "tenant-a");
  });
});
