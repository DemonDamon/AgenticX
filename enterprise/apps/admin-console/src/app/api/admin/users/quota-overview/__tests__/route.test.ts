import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const loadUserQuotaOverviewMock = vi.fn();

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../../lib/quota-overview", () => ({
  loadUserQuotaOverview: (...args: unknown[]) => loadUserQuotaOverviewMock(...args),
}));

describe("GET /api/admin/users/quota-overview", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    loadUserQuotaOverviewMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    loadUserQuotaOverviewMock.mockResolvedValue([]);
  });

  it("rejects more than 100 ids", async () => {
    const { GET } = await import("../route");
    const ids = Array.from({ length: 101 }, (_, index) => `u${index}`).join(",");
    const response = await GET(new Request(`https://admin.example.com/api/admin/users/quota-overview?userIds=${ids}`));
    expect(response.status).toBe(400);
    expect(loadUserQuotaOverviewMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller cannot read metering", async () => {
    const { GET } = await import("../route");
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40300", message: "forbidden" }), { status: 403 }),
    });
    const response = await GET(new Request("https://admin.example.com/api/admin/users/quota-overview?userIds=a"));
    expect(response.status).toBe(403);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["metering:read"]);
    expect(loadUserQuotaOverviewMock).not.toHaveBeenCalled();
  });

  it("loads the requested members for the signed-in tenant", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example.com/api/admin/users/quota-overview?userIds=a,b"));
    expect(response.status).toBe(200);
    expect(loadUserQuotaOverviewMock).toHaveBeenCalledWith("tenant-a", ["a", "b"]);
  });
});
