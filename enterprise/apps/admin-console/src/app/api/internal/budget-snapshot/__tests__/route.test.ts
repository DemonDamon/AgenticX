import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
  buildBudgetSnapshotForGateway: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) => mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => Response.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
}));

vi.mock("../../../../../lib/budget-store", () => ({
  buildBudgetSnapshotForGateway: (...args: unknown[]) => mocks.buildBudgetSnapshotForGateway(...args),
}));

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe("internal budget snapshot", () => {
  beforeEach(() => {
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.buildBudgetSnapshotForGateway.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
    mocks.buildBudgetSnapshotForGateway.mockImplementation(async (tenantId: string) => ({
      version: 2,
      tenantId,
      userGroups: { analyst: ["analysts"] },
    }));
    process.env.DEFAULT_TENANT_ID = "tenant-default";
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it("uses the tenant header when the gateway sends one", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "tenant-a" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 2,
      tenantId: "tenant-a",
      userGroups: { analyst: ["analysts"] },
    });
    expect(mocks.buildBudgetSnapshotForGateway).toHaveBeenCalledWith("tenant-a");
  });

  it("falls back to the default tenant when the header is absent", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example.com/api/internal/budget-snapshot"));

    expect(response.status).toBe(200);
    expect(mocks.buildBudgetSnapshotForGateway).toHaveBeenCalledWith("tenant-default");
  });

  it("rejects an unauthorized caller before reading a tenant", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "tenant-a" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.buildBudgetSnapshotForGateway).not.toHaveBeenCalled();
  });
});
