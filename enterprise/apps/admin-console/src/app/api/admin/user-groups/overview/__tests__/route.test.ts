import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const loadGroupLimitOverviewMock = vi.fn();

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../../lib/quota-overview", () => ({
  loadGroupLimitOverview: (...args: unknown[]) => loadGroupLimitOverviewMock(...args),
}));

describe("GET /api/admin/user-groups/overview", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    loadGroupLimitOverviewMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
  });

  it("returns 403 without metering read", async () => {
    const { GET } = await import("../route");
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40300", message: "forbidden" }), { status: 403 }),
    });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(loadGroupLimitOverviewMock).not.toHaveBeenCalled();
  });

  it("returns each group's member count and rule summary", async () => {
    const { GET } = await import("../route");
    loadGroupLimitOverviewMock.mockResolvedValue([
      { id: "g1", name: "分析组", memberCount: 2, spending: null, search: { day: 0, week: 0, month: 0 }, research: { day: 1, week: 0, month: 0 } },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: { groups: [expect.objectContaining({ id: "g1", memberCount: 2 })] },
    });
    expect(loadGroupLimitOverviewMock).toHaveBeenCalledWith("tenant-a");
  });
});