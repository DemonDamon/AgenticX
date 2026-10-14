import { describe, expect, it } from "vitest";
import { poolScopeForAssignment } from "./quota-pool-scope";

describe("poolScopeForAssignment", () => {
  it("keeps a department assignment on that department pool", () => {
    expect(poolScopeForAssignment("dept", "tenant-1", "dept-9")).toEqual({
      scopeType: "dept",
      scopeId: "dept-9",
    });
  });

  it("keeps a tenant assignment on the tenant pool", () => {
    expect(poolScopeForAssignment("tenant", "tenant-1", "ignored")).toEqual({
      scopeType: "tenant",
      scopeId: "tenant-1",
    });
  });
});
