import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  softDeleteUser: vi.fn(),
  removeUserFromAllGroups: vi.fn(),
  getDefaultOrgId: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  getAdminUser: vi.fn(),
  softDeleteUser: (...args: unknown[]) => mocks.softDeleteUser(...args),
  updateAdminUser: vi.fn(),
}));

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../../lib/admin-pg-auth", () => ({
  getDefaultOrgId: (...args: unknown[]) => mocks.getDefaultOrgId(...args),
}));

vi.mock("../../../../../../lib/user-groups-store", () => ({
  removeUserFromAllGroups: (...args: unknown[]) => mocks.removeUserFromAllGroups(...args),
}));

describe("admin user delete route", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireAdminScope.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
    mocks.softDeleteUser.mockResolvedValue(undefined);
    mocks.removeUserFromAllGroups.mockResolvedValue(2);
  });

  it("removes the deleted user from all groups after IAM deletion", async () => {
    const { DELETE } = await import("../route");
    const response = await DELETE(
      new Request("https://admin.example.com/api/admin/users/deleted", { method: "DELETE" }),
      { params: Promise.resolve({ id: "deleted" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: { removedFromGroups: 2, groupCleanupPending: false },
    });
    expect(mocks.softDeleteUser).toHaveBeenCalledWith("tenant-a", "deleted", "admin-a");
    expect(mocks.removeUserFromAllGroups).toHaveBeenCalledWith("deleted");
    expect(mocks.softDeleteUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeUserFromAllGroups.mock.invocationCallOrder[0]!,
    );
  });

  it("does not report IAM deletion as failed when best-effort group cleanup fails", async () => {
    mocks.removeUserFromAllGroups.mockRejectedValue(new Error("quota store unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { DELETE } = await import("../route");

    const response = await DELETE(
      new Request("https://admin.example.com/api/admin/users/deleted", { method: "DELETE" }),
      { params: Promise.resolve({ id: "deleted" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "00000",
      data: { removedFromGroups: 0, groupCleanupPending: true },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[admin/users] deleted user group cleanup failed:",
      expect.stringContaining("quota store unavailable"),
    );
    consoleError.mockRestore();
  });
});
