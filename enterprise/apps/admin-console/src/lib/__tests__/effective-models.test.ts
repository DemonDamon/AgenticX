import { describe, expect, it } from "vitest";

import {
  clipToAllowed,
  computeEffectiveDeptAllowed,
  computeEffectiveUserAllowed,
  computeParentAllowedIds,
  computePrunedModelIds,
  mergeUserStoredSet,
} from "../effective-models";

const ALL = ["a/A", "a/B", "a/C", "b/X"];

describe("effective-models", () => {
  it("root empty config → all enabled", () => {
    const allowed = computeEffectiveDeptAllowed({
      allEnabledIds: ALL,
      userVisibleMap: {},
      ancestorChain: ["root"],
    });
    expect(allowed.sort()).toEqual(ALL.sort());
  });

  it("root=AB, child empty → AB", () => {
    const map = { "dept:root": ["a/A", "a/B"] };
    const allowed = computeEffectiveDeptAllowed({
      allEnabledIds: ALL,
      userVisibleMap: map,
      ancestorChain: ["child", "root"],
    });
    expect(allowed.sort()).toEqual(["a/A", "a/B"]);
  });

  it("root=AB, child=BC → B", () => {
    const map = {
      "dept:root": ["a/A", "a/B"],
      "dept:child": ["a/B", "a/C"],
    };
    const allowed = computeEffectiveDeptAllowed({
      allEnabledIds: ALL,
      userVisibleMap: map,
      ancestorChain: ["child", "root"],
    });
    expect(allowed).toEqual(["a/B"]);
  });

  it("root=AB, child=CD → empty", () => {
    const map = {
      "dept:root": ["a/A", "a/B"],
      "dept:child": ["a/C", "b/X"],
    };
    const allowed = computeEffectiveDeptAllowed({
      allEnabledIds: ALL,
      userVisibleMap: map,
      ancestorChain: ["child", "root"],
    });
    expect(allowed).toEqual([]);
  });

  it("computeParentAllowedIds for non-root uses parent effective", () => {
    const map = { "dept:root": ["a/A", "a/B"] };
    const parent = computeParentAllowedIds(ALL, map, ["child", "root"]);
    expect(parent.sort()).toEqual(["a/A", "a/B"]);
  });

  it("user intersects with dept effective", () => {
    const dept = ["a/A", "a/B"];
    expect(computeEffectiveUserAllowed(dept, ["a/B", "a/C"])).toEqual(["a/B"]);
    expect(computeEffectiveUserAllowed(dept, null)).toEqual(dept);
  });

  it("clipToAllowed prunes out-of-parent ids", () => {
    const { saved, prunedModelIds } = clipToAllowed(["a/A", "a/C"], new Set(["a/A", "a/B"]));
    expect(saved).toEqual(["a/A"]);
    expect(prunedModelIds).toEqual(["a/C"]);
  });

  it("mergeUserStoredSet unions configured keys", () => {
    const map = {
      u1: ["a/A"],
      "email:a@b.c": ["a/B"],
    };
    expect(mergeUserStoredSet(map, ["u1", "email:a@b.c"])?.sort()).toEqual(["a/A", "a/B"]);
    expect(mergeUserStoredSet(map, ["missing"])).toBeNull();
  });

  it("computePrunedModelIds lists stored outside allowed", () => {
    expect(computePrunedModelIds(["a/A", "x/Y"], new Set(["a/A"]))).toEqual(["x/Y"]);
  });
});
