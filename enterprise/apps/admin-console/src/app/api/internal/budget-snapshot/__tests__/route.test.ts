import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
  buildBudgetSnapshotForGateway: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) =>
    mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => new Response("unauthorized", { status: 401 }),
}));

vi.mock("../../../../../lib/budget-store", () => ({
  buildBudgetSnapshotForGateway: (...args: unknown[]) =>
    mocks.buildBudgetSnapshotForGateway(...args),
}));

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe("internal budget snapshot tenant selection", () => {
  beforeEach(() => {
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.buildBudgetSnapshotForGateway.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
    mocks.buildBudgetSnapshotForGateway.mockImplementation(async (tenantId: string) => ({
      tenantId,
      defaults: { maxToolRounds: tenantId === "tenant-a" ? 12 : 24 },
    }));
    process.env.DEFAULT_TENANT_ID = "tenant-default";
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it("returns the snapshot for each authenticated tenant without crossing tenants", async () => {
    const { GET } = await import("../route");
    const tenantAResponse = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "tenant-a" },
      }),
    );
    const tenantBResponse = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "tenant-b" },
      }),
    );

    expect(tenantAResponse.status).toBe(200);
    expect(tenantBResponse.status).toBe(200);
    await expect(tenantAResponse.json()).resolves.toMatchObject({
      tenantId: "tenant-a",
      defaults: { maxToolRounds: 12 },
    });
    await expect(tenantBResponse.json()).resolves.toMatchObject({
      tenantId: "tenant-b",
      defaults: { maxToolRounds: 24 },
    });
    expect(mocks.buildBudgetSnapshotForGateway).toHaveBeenNthCalledWith(1, "tenant-a");
    expect(mocks.buildBudgetSnapshotForGateway).toHaveBeenNthCalledWith(2, "tenant-b");
  });

  it("keeps the configured default for existing single-tenant gateway callers", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot"),
    );

    expect(response.status).toBe(200);
    expect(mocks.buildBudgetSnapshotForGateway).toHaveBeenCalledWith("tenant-default");
  });

  it("rejects an invalid tenant header instead of falling back to the default", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "../tenant-a" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "tenant_required" });
    expect(mocks.buildBudgetSnapshotForGateway).not.toHaveBeenCalled();
  });

  it("checks internal authentication before accepting any tenant header", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/budget-snapshot", {
        headers: { "x-agenticx-tenant-id": "../tenant-a" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.buildBudgetSnapshotForGateway).not.toHaveBeenCalled();
  });
});
