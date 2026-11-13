import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  updateVirtualModel: vi.fn(),
  deleteVirtualModel: vi.fn(),
}));

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../../lib/virtual-models-store", () => ({
  updateVirtualModel: (...args: unknown[]) => mocks.updateVirtualModel(...args),
  deleteVirtualModel: (...args: unknown[]) => mocks.deleteVirtualModel(...args),
}));

const body = {
  name: "team-default",
  displayName: "团队默认",
  enabled: false,
  targets: [{ model: "gpt-4o-mini", weight: 2, priority: 1 }],
};

describe("admin virtual model item", () => {
  beforeEach(() => {
    mocks.requireAdminScope.mockReset();
    mocks.updateVirtualModel.mockReset();
    mocks.deleteVirtualModel.mockReset();
    mocks.requireAdminScope.mockResolvedValue({ ok: true });
    mocks.updateVirtualModel.mockImplementation(async (id: string, input: unknown) => ({ id, ...(input as object) }));
    mocks.deleteVirtualModel.mockResolvedValue(undefined);
  });

  it("updates a virtual model", async () => {
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("https://admin.example/api/admin/virtual-models/vm1", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "vm1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["provider:update"]);
    expect(mocks.updateVirtualModel).toHaveBeenCalledWith("vm1", body);
  });

  it("deletes a virtual model", async () => {
    const { DELETE } = await import("../route");
    const response = await DELETE(new Request("https://admin.example/api/admin/virtual-models/vm1"), {
      params: Promise.resolve({ id: "vm1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["provider:delete"]);
    expect(mocks.deleteVirtualModel).toHaveBeenCalledWith("vm1");
  });
});
