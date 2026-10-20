import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroups = vi.hoisted(() => vi.fn());
const readRoles = vi.hoisted(() => vi.fn());

vi.mock("@agenticx/iam-core", () => ({
  listUserGroupIdsForUser: listGroups,
  getUserRolesDetail: readRoles,
}));

import { featureUsageSubject } from "../subject";

const session = { tenantId: "t1", userId: "u1", deptId: "d1", scopes: ["workspace:chat"] };

beforeEach(() => {
  listGroups.mockReset();
  readRoles.mockReset();
  readRoles.mockResolvedValue({ roleCodes: ["member"], scopes: ["workspace:chat"] });
});

describe("feature usage subject", () => {
  it("reads current group membership and role codes on each request", async () => {
    listGroups.mockResolvedValueOnce(["g1", "g2"]).mockResolvedValueOnce(["g2"]);

    const first = await featureUsageSubject(session);
    const second = await featureUsageSubject(session);

    expect(first).toMatchObject({
      tenantId: "t1",
      userId: "u1",
      deptId: "d1",
      roles: ["member"],
      groupIds: ["g1", "g2"],
    });
    expect(second.groupIds).toEqual(["g2"]);
    expect(listGroups).toHaveBeenNthCalledWith(2, "t1", "u1");
    expect(readRoles).toHaveBeenCalledWith("t1", "u1");
  });

  it("falls back to no roles when the role table cannot be read", async () => {
    listGroups.mockResolvedValue([]);
    readRoles.mockRejectedValue(new Error("role table down"));
    expect((await featureUsageSubject(session)).roles).toEqual([]);
  });
});
