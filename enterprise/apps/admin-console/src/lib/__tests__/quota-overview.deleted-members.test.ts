import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  listDepartmentsFlat: vi.fn(),
  queryMetering: vi.fn(),
  getQuotaConfig: vi.fn(),
  listUserGroups: vi.fn(),
  listAllAssignments: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  listTenantOptOuts: async () => new Map<string, string[]>(),
  listAdminUsers: (...args: unknown[]) => mocks.listAdminUsers(...args),
  listDepartmentsFlat: (...args: unknown[]) => mocks.listDepartmentsFlat(...args),
}));

vi.mock("../metering-service", () => ({
  queryMetering: (...args: unknown[]) => mocks.queryMetering(...args),
}));

vi.mock("../token-quota-store", () => ({
  getQuotaConfig: (...args: unknown[]) => mocks.getQuotaConfig(...args),
}));

vi.mock("../user-groups-store", () => ({
  listUserGroups: (...args: unknown[]) => mocks.listUserGroups(...args),
  groupQuotaSourceForUser: (groups: Array<{ memberIds: string[] }>, userId: string) =>
    groups.find((group) => group.memberIds.includes(userId)) ?? null,
  groupModelIdsForUser: () => [],
}));

vi.mock("../user-models-store", () => ({
  collectUserAssignmentKeys: () => [],
  listAllAssignments: (...args: unknown[]) => mocks.listAllAssignments(...args),
  mergeUserStoredSet: () => null,
}));

vi.mock("../model-providers-store", () => ({
  listAllEnabledModelIds: vi.fn(async () => []),
}));

import { loadGroupQuotaOverview } from "../quota-overview";

describe("loadGroupQuotaOverview deleted members", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listAdminUsers.mockResolvedValue({
      items: [
        {
          id: "live",
          displayName: "仍在职用户",
          email: "live@example.com",
          deptId: null,
        },
      ],
      total: 1,
    });
    mocks.listDepartmentsFlat.mockResolvedValue([]);
    mocks.getQuotaConfig.mockResolvedValue({
      defaults: { role: {}, model: {} },
      users: {},
      departments: {},
      groups: {},
      modelExclusions: {},
    });
    mocks.listAllAssignments.mockResolvedValue({});
    mocks.listUserGroups.mockResolvedValue([
      {
        id: "group-a",
        name: "测试组",
        memberIds: ["live", "deleted"],
        monthlyTokens: 0,
        modelIds: [],
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    ]);
  });

  it("returns only active IAM users in memberIds and the edit member count", async () => {
    const overview = await loadGroupQuotaOverview("tenant-a");

    expect(overview.groups[0]?.memberIds).toEqual(["live"]);
    expect(overview.groups[0]?.memberCount).toBe(1);
    expect(overview.groups[0]?.members.map((member) => member.id)).toEqual(["live"]);
    expect(mocks.getQuotaConfig).toHaveBeenCalledWith("tenant-a");
    expect(mocks.listUserGroups).toHaveBeenCalledWith("tenant-a");
    expect(mocks.listAllAssignments).toHaveBeenCalledWith("tenant-a");
  });
});
