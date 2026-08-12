import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  getAdminUser: vi.fn(),
  getUserGroup: vi.fn(),
  updateUserGroup: vi.fn(),
  applyUserGroupPolicy: vi.fn(),
  deleteUserGroup: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  getAdminUser: (...args: unknown[]) => mocks.getAdminUser(...args),
}));

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../../lib/user-groups-store", () => ({
  applyUserGroupPolicy: (...args: unknown[]) => mocks.applyUserGroupPolicy(...args),
  deleteUserGroup: (...args: unknown[]) => mocks.deleteUserGroup(...args),
  getUserGroup: (...args: unknown[]) => mocks.getUserGroup(...args),
  updateUserGroup: (...args: unknown[]) => mocks.updateUserGroup(...args),
}));

describe("user group update route", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    mocks.getUserGroup.mockResolvedValue({
      id: "group-a",
      name: "原名称",
      memberIds: ["live", "deleted"],
      monthlyTokens: 0,
      modelIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    mocks.getAdminUser.mockImplementation(async (_tenantId: string, userId: string) =>
      userId === "live" ? { id: "live" } : null,
    );
    mocks.updateUserGroup.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      id,
      name: "新名称",
      memberIds: [],
      monthlyTokens: 0,
      modelIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      ...patch,
    }));
    mocks.applyUserGroupPolicy.mockResolvedValue(undefined);
  });

  it("does not return a deleted legacy member to edit clients", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://admin.example.com/api/admin/user-groups/group-a"),
      { params: Promise.resolve({ id: "group-a" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: { group: { memberIds: ["live"] } },
    });
  });

  it("prunes a deleted legacy member instead of rejecting the whole save", async () => {
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example.com/api/admin/user-groups/group-a", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "新名称", memberIds: ["live", "deleted"] }),
      }),
      { params: Promise.resolve({ id: "group-a" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: {
        group: { memberIds: ["live"] },
        removedMissingMembers: 1,
      },
    });
    expect(mocks.updateUserGroup).toHaveBeenCalledWith(
      "group-a",
      expect.objectContaining({ name: "新名称", memberIds: ["live"] }),
    );
    expect(mocks.applyUserGroupPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: ["live"] }),
      [{ id: "live" }],
    );
  });
});
