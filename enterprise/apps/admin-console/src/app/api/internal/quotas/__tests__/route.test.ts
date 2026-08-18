import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
  getQuotaConfig: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) =>
    mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => new Response("unauthorized", { status: 401 }),
}));

vi.mock("../../../../../lib/token-quota-store", () => ({
  getQuotaConfig: (...args: unknown[]) => mocks.getQuotaConfig(...args),
}));

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe("internal quota snapshot tenant selection", () => {
  beforeEach(() => {
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.getQuotaConfig.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
    mocks.getQuotaConfig.mockResolvedValue({ users: {} });
    process.env.DEFAULT_TENANT_ID = "tenant-default";
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it("uses the tenant header only after internal authentication succeeds", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/quotas", {
        headers: { "x-agenticx-tenant-id": "tenant-a" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getQuotaConfig).toHaveBeenCalledWith("tenant-a");
  });

  it("keeps the configured default for existing single-tenant gateway callers", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/quotas"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getQuotaConfig).toHaveBeenCalledWith("tenant-default");
  });

  it("does not read any tenant snapshot for an unauthorized caller", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/internal/quotas", {
        headers: { "x-agenticx-tenant-id": "tenant-a" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getQuotaConfig).not.toHaveBeenCalled();
  });
});
