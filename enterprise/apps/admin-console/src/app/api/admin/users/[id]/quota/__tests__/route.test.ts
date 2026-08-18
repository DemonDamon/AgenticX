import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  getAdminUser: vi.fn(),
  getQuotaConfig: vi.fn(),
  setQuotaConfig: vi.fn(),
  listUserGroups: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@agenticx/iam-core", () => ({
  getAdminUser: (...args: unknown[]) => mocks.getAdminUser(...args),
}));

vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("../../../../../../../lib/token-quota-store", () => ({
  getQuotaConfig: (...args: unknown[]) => mocks.getQuotaConfig(...args),
  setQuotaConfig: (...args: unknown[]) => mocks.setQuotaConfig(...args),
}));

vi.mock("../../../../../../../lib/user-groups-store", () => ({
  listUserGroups: (...args: unknown[]) => mocks.listUserGroups(...args),
  groupQuotaSourceForUser: () => null,
}));

type TestConfig = {
  defaults: { role: Record<string, never>; model: Record<string, never> };
  users: Record<string, { monthlyTokens: number; action: string }>;
  departments: Record<string, never>;
  updatedAt: string;
};

function emptyConfig(updatedAt: string): TestConfig {
  return {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    updatedAt,
  };
}

describe("per-user quota tenant isolation", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAdminUser.mockImplementation(async (tenantId: string, userId: string) => ({
      id: userId,
      tenantId,
    }));
    mocks.listUserGroups.mockResolvedValue([]);
  });

  it("keeps the same user id independent across authenticated tenants", async () => {
    const rows = new Map([
      ["tenant-a", emptyConfig("2026-08-18T00:00:00.000Z")],
      ["tenant-b", emptyConfig("2026-08-18T00:00:01.000Z")],
    ]);
    mocks.getQuotaConfig.mockImplementation(async (tenantId: string) => rows.get(tenantId));
    mocks.setQuotaConfig.mockImplementation(async (patch, tenantId) => {
      const current = rows.get(tenantId)!;
      const next = { ...current, ...patch };
      rows.set(tenantId, next);
      return next;
    });
    mocks.requireAdminScope
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-a", userId: "admin-a" } })
      .mockResolvedValueOnce({ ok: true, session: { tenantId: "tenant-b", userId: "admin-b" } });

    const { PUT } = await import("../route");
    const context = { params: Promise.resolve({ id: "shared-user" }) };
    const first = await PUT(
      new Request("https://admin.example.com/api/admin/users/shared-user/quota", {
        method: "PUT",
        body: JSON.stringify({ monthlyTokens: 111 }),
      }),
      context,
    );
    const second = await PUT(
      new Request("https://admin.example.com/api/admin/users/shared-user/quota", {
        method: "PUT",
        body: JSON.stringify({ monthlyTokens: 222 }),
      }),
      context,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rows.get("tenant-a")?.users["shared-user"]?.monthlyTokens).toBe(111);
    expect(rows.get("tenant-b")?.users["shared-user"]?.monthlyTokens).toBe(222);
    expect(mocks.getQuotaConfig).toHaveBeenNthCalledWith(1, "tenant-a");
    expect(mocks.getQuotaConfig).toHaveBeenNthCalledWith(2, "tenant-b");
  });
});
