import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuotaConfig: vi.fn(),
  setQuotaConfig: vi.fn(),
}));

vi.mock("../token-quota-store", () => ({
  getQuotaConfig: (...args: unknown[]) => mocks.getQuotaConfig(...args),
  setQuotaConfig: (...args: unknown[]) => mocks.setQuotaConfig(...args),
}));

import { removeUserFromAllGroups } from "../user-groups-store";

function quotaConfig() {
  const now = "2026-08-12T00:00:00.000Z";
  return {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    groups: {
      first: {
        name: "第一组",
        memberIds: ["keep", "deleted"],
        monthlyTokens: 0,
        modelIds: [],
        createdAt: now,
        updatedAt: now,
      },
      second: {
        name: "第二组",
        memberIds: ["deleted"],
        monthlyTokens: 100,
        modelIds: ["provider/model"],
        createdAt: now,
        updatedAt: now,
      },
      untouched: {
        name: "未受影响",
        memberIds: ["keep"],
        monthlyTokens: 200,
        modelIds: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    modelExclusions: {},
    updatedAt: now,
  };
}

describe("removeUserFromAllGroups", () => {
  beforeEach(() => {
    mocks.getQuotaConfig.mockReset();
    mocks.setQuotaConfig.mockReset();
  });

  it("removes a deleted user from every group in one persisted update", async () => {
    mocks.getQuotaConfig.mockResolvedValue(quotaConfig());
    mocks.setQuotaConfig.mockImplementation(async (config) => config);

    await expect(removeUserFromAllGroups("tenant-a", "deleted")).resolves.toBe(2);

    expect(mocks.getQuotaConfig).toHaveBeenCalledWith("tenant-a");
    expect(mocks.setQuotaConfig).toHaveBeenCalledTimes(1);
    const saved = mocks.setQuotaConfig.mock.calls[0]?.[0];
    expect(saved.groups.first.memberIds).toEqual(["keep"]);
    expect(saved.groups.second.memberIds).toEqual([]);
    expect(saved.groups.untouched.memberIds).toEqual(["keep"]);
    expect(saved.groups.untouched.updatedAt).toBe("2026-08-12T00:00:00.000Z");
    expect(mocks.setQuotaConfig.mock.calls[0]?.[1]).toBe("tenant-a");
  });

  it("does not write when the user is not referenced by any group", async () => {
    mocks.getQuotaConfig.mockResolvedValue(quotaConfig());

    await expect(removeUserFromAllGroups("tenant-a", "missing")).resolves.toBe(0);
    expect(mocks.setQuotaConfig).not.toHaveBeenCalled();
  });
});
