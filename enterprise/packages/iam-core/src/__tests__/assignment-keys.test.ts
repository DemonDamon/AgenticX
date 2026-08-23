import { beforeEach, describe, expect, it, vi } from "vitest";

const listDepartmentAncestorIds = vi.fn();
const listUserGroupIdsForUser = vi.fn();

vi.mock("../repos/departments", () => ({
  listDepartmentAncestorIds: (...args: unknown[]) => listDepartmentAncestorIds(...args),
}));

vi.mock("../repos/user-groups", () => ({
  groupAssignmentKey: (id: string) => `group:${String(id ?? "").trim()}`,
  listUserGroupIdsForUser: (...args: unknown[]) => listUserGroupIdsForUser(...args),
}));

import {
  ALL_MEMBERS_ASSIGNMENT_KEY,
  deptAssignmentKey,
  resolveAssignmentKeysForUser,
} from "../repos/assignment-keys";

describe("resolveAssignmentKeysForUser", () => {
  beforeEach(() => {
    listDepartmentAncestorIds.mockReset();
    listUserGroupIdsForUser.mockReset();
    listDepartmentAncestorIds.mockResolvedValue([]);
    listUserGroupIdsForUser.mockResolvedValue([]);
  });

  it("always includes the all-members key and the user id", async () => {
    const keys = await resolveAssignmentKeysForUser("t1", "01USER");
    expect(keys).toContain(ALL_MEMBERS_ASSIGNMENT_KEY);
    expect(keys).toContain("01USER");
  });

  it("normalizes email and expands department ancestors plus groups", async () => {
    listDepartmentAncestorIds.mockResolvedValue(["leaf", "root"]);
    listUserGroupIdsForUser.mockResolvedValue(["G1", "G2"]);

    const keys = await resolveAssignmentKeysForUser(
      "t1",
      "01USER",
      "Ada@Example.com",
      "leaf",
    );

    expect(keys).toEqual(
      expect.arrayContaining([
        ALL_MEMBERS_ASSIGNMENT_KEY,
        "01USER",
        "email:ada@example.com",
        deptAssignmentKey("leaf"),
        deptAssignmentKey("root"),
        "group:G1",
        "group:G2",
      ]),
    );
    expect(listDepartmentAncestorIds).toHaveBeenCalledWith("t1", "leaf");
    expect(listUserGroupIdsForUser).toHaveBeenCalledWith("t1", "01USER");
  });

  it("keeps other keys when group lookup fails", async () => {
    listUserGroupIdsForUser.mockRejectedValue(new Error("relation does not exist"));

    const keys = await resolveAssignmentKeysForUser("t1", "01USER");
    expect(keys).toEqual([ALL_MEMBERS_ASSIGNMENT_KEY, "01USER"]);
  });
});
