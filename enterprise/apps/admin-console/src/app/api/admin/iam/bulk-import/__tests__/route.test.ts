import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getDefaultOrgIdMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("@agenticx/auth", () => ({
  hashPassword: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  findOrCreateDepartmentPath: vi.fn(),
  getDefaultOrgId: (...args: unknown[]) => getDefaultOrgIdMock(...args),
  getIamDb: vi.fn(),
  upsertUserByEmailInTx: vi.fn(),
}));

describe("IAM bulk import route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    getDefaultOrgIdMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-a", userId: "admin-a" },
    });
  });

  it("returns a JSON error when setup fails before row processing", async () => {
    getDefaultOrgIdMock.mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example.com/api/admin/iam/bulk-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: [{ email: "user@example.com", displayName: "User" }],
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      code: "50001",
      message: "批量导入失败，请稍后重试；如持续失败请联系管理员",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[admin/iam/bulk-import] request failed:",
      expect.stringContaining("database unavailable"),
    );
    consoleError.mockRestore();
  });
});
