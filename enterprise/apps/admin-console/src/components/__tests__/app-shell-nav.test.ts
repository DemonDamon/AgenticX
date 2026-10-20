import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "../AppShell";

describe("AppShell IAM navigation", () => {
  it("lists only organization and roles", () => {
    const iam = NAV_GROUPS.find((group) => group.id === "iam");
    expect(iam?.items.map((item) => item.href)).toEqual(["/iam/members", "/iam/roles"]);
    expect(iam?.items.map((item) => item.labelKey)).toEqual(["members", "roles"]);
  });
});
