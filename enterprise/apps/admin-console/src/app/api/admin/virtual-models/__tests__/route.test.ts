import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  listVirtualModels: vi.fn(),
  createVirtualModel: vi.fn(),
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../lib/virtual-models-store", () => ({
  listVirtualModels: (...args: unknown[]) => mocks.listVirtualModels(...args),
  createVirtualModel: (...args: unknown[]) => mocks.createVirtualModel(...args),
}));

const body = {
  name: "team-default",
  displayName: "团队默认",
  enabled: true,
  targets: [{ model: "gpt-4o-mini", weight: 1, priority: 0 }],
};

describe("admin virtual model collection", () => {
  beforeEach(() => {
    mocks.requireAdminScope.mockReset();
    mocks.listVirtualModels.mockReset();
    mocks.createVirtualModel.mockReset();
    mocks.requireAdminScope.mockResolvedValue({ ok: true });
    mocks.listVirtualModels.mockResolvedValue([]);
    mocks.createVirtualModel.mockImplementation(async (input: unknown) => ({ id: "01HZX", ...(input as object) }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("creates a virtual model", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example/api/admin/virtual-models", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["provider:create"]);
    expect(mocks.createVirtualModel).toHaveBeenCalledWith(body);
  });

  it("rejects an invalid create before writing", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example/api/admin/virtual-models", {
        method: "POST",
        body: JSON.stringify({ ...body, name: "bad name" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createVirtualModel).not.toHaveBeenCalled();
  });
});
