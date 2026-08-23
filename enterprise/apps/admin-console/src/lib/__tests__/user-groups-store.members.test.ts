import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGroupRow: vi.fn(),
  updateGroupRow: vi.fn(),
  getGroupRow: vi.fn(),
  listGroupRows: vi.fn(),
  listGroupModelIds: vi.fn(),
  setGroupModelIds: vi.fn(),
  migrateLegacyUserGroupsIfNeeded: vi.fn(),
  migrateLegacyGroupModelsIfNeeded: vi.fn(),
}));

vi.mock("@agenticx/iam-core", () => ({
  createUserGroup: (...args: unknown[]) => mocks.createGroupRow(...args),
  updateUserGroup: (...args: unknown[]) => mocks.updateGroupRow(...args),
  getUserGroup: (...args: unknown[]) => mocks.getGroupRow(...args),
  listUserGroups: (...args: unknown[]) => mocks.listGroupRows(...args),
  listGroupModelIds: (...args: unknown[]) => mocks.listGroupModelIds(...args),
  setGroupModelIds: (...args: unknown[]) => mocks.setGroupModelIds(...args),
  migrateLegacyUserGroupsIfNeeded: (...args: unknown[]) =>
    mocks.migrateLegacyUserGroupsIfNeeded(...args),
  migrateLegacyGroupModelsIfNeeded: (...args: unknown[]) =>
    mocks.migrateLegacyGroupModelsIfNeeded(...args),
  listUserOptOuts: vi.fn(async () => []),
  replaceUserOptOutSubjects: vi.fn(async (_t: string, _u: string, subjects: string[]) => subjects),
  deleteUserGroup: vi.fn(async () => true),
}));

import { createUserGroup, updateUserGroup } from "../user-groups-store";

const ROW = {
  id: "01JGROUP000000000000000001",
  tenantId: "tenant-a",
  name: "研究组",
  description: "",
  memberIds: ["live"],
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("user-groups-store membership", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.migrateLegacyUserGroupsIfNeeded.mockResolvedValue({ action: "skipped", count: 0 });
    mocks.migrateLegacyGroupModelsIfNeeded.mockResolvedValue({ action: "skipped", count: 0 });
    mocks.listGroupModelIds.mockResolvedValue(new Map());
    mocks.setGroupModelIds.mockImplementation(async (_tenant: string, _id: string, modelIds: string[]) => modelIds);
    mocks.createGroupRow.mockResolvedValue(ROW);
    mocks.getGroupRow.mockResolvedValue(ROW);
    mocks.updateGroupRow.mockResolvedValue({ ...ROW, memberIds: [] });
  });

  it("creates a group with the members that later expand to group assignment keys", async () => {
    const group = await createUserGroup("tenant-a", {
      name: "研究组",
      memberIds: ["live"],
    });
    expect(mocks.createGroupRow).toHaveBeenCalledWith("tenant-a", {
      name: "研究组",
      description: null,
      memberIds: ["live"],
    });
    expect(group.id).toBe(ROW.id);
    expect(group.memberIds).toEqual(["live"]);
  });

  it("replaces members so a removed user no longer belongs to the group", async () => {
    const group = await updateUserGroup("tenant-a", ROW.id, { memberIds: [] });
    expect(mocks.updateGroupRow).toHaveBeenCalledWith(
      "tenant-a",
      ROW.id,
      expect.objectContaining({ memberIds: [] }),
    );
    expect(group.memberIds).toEqual([]);
  });
});
