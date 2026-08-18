import { describe, expect, it } from "vitest";

import { isFeatureAllowedByAssignments, isAssignableFeature } from "../repos/feature-assignments";

describe("isFeatureAllowedByAssignments", () => {
  it("allows everyone when nothing is assigned", () => {
    // 管理员打开总开关就是想让大家用；要求逐个分配才能用，漏点的表现是「他那边就是没有」。
    expect(isFeatureAllowedByAssignments([], ["all", "u1"])).toBe(true);
  });

  it("restricts to the assigned keys once any assignment exists", () => {
    expect(isFeatureAllowedByAssignments(["dept:d1"], ["all", "u1", "dept:d2"])).toBe(false);
    expect(isFeatureAllowedByAssignments(["dept:d1"], ["all", "u1", "dept:d1"])).toBe(true);
  });

  it("treats an explicit all-members assignment as covering everyone", () => {
    expect(isFeatureAllowedByAssignments(["all"], ["all", "u1"])).toBe(true);
  });

  it("grants through any one of the user's groups", () => {
    // 组是授予：命中任意一个就够，不需要全部命中。
    expect(
      isFeatureAllowedByAssignments(["group:g2"], ["all", "u1", "group:g1", "group:g2"]),
    ).toBe(true);
  });
});

describe("isAssignableFeature", () => {
  it("pins the feature ids the admin console and portal must agree on", () => {
    expect(isAssignableFeature("web_search")).toBe(true);
    expect(isAssignableFeature("deep_research")).toBe(true);
    expect(isAssignableFeature("websearch")).toBe(false);
  });
});
