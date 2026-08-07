import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const fetchGatewayPolicyStatusMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/gateway-ops-store", () => ({
  fetchGatewayPolicyStatus: (...args: unknown[]) => fetchGatewayPolicyStatusMock(...args),
}));

describe("gateway policy status route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    fetchGatewayPolicyStatusMock.mockReset();
  });

  it("queries only the authenticated admin tenant", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    fetchGatewayPolicyStatusMock.mockResolvedValue({
      code: "00000",
      message: "ok",
      data: { tenant: { tenantId: "tenant-a", version: 4, publishId: "publish-4" } },
    });

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchGatewayPolicyStatusMock).toHaveBeenCalledWith("tenant-a");
    expect(await response.json()).toMatchObject({
      data: { tenant: { version: 4, publishId: "publish-4" } },
    });
  });

  it("returns 502 when gateway status cannot be read", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    fetchGatewayPolicyStatusMock.mockRejectedValue(new Error("gateway offline"));

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "50203", message: "gateway offline" });
  });
});
