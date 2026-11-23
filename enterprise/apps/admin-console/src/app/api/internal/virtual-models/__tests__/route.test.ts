import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
  listVirtualModelsInternal: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) => mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => Response.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
}));

vi.mock("../../../../../lib/virtual-models-store", () => ({
  listVirtualModelsInternal: (...args: unknown[]) => mocks.listVirtualModelsInternal(...args),
}));

describe("internal virtual models snapshot", () => {
  beforeEach(() => {
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.listVirtualModelsInternal.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
    mocks.listVirtualModelsInternal.mockResolvedValue([
      {
        id: "vm1",
        tenantId: "tenant-a",
        name: "team-default",
        displayName: "团队默认",
        enabled: true,
        targets: [{ model: "gpt-4o-mini", weight: 1, priority: 0 }],
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
    ]);
  });

  it("returns 401 before reading virtual models", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example/api/internal/virtual-models"));
    expect(response.status).toBe(401);
    expect(mocks.listVirtualModelsInternal).not.toHaveBeenCalled();
  });

  it("returns the snapshot for an authorized caller", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("https://admin.example/api/internal/virtual-models"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      virtualModels: [
        {
          tenantId: "tenant-a",
          name: "team-default",
          displayName: "团队默认",
          enabled: true,
          targets: [{ model: "gpt-4o-mini", weight: 1, priority: 0 }],
        },
      ],
    });
  });
});
