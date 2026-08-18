import { describe, expect, it } from "vitest";

import { computeEffectiveUserAllowed, mergeAssignedModelIds } from "./effective-models";

describe("computeEffectiveUserAllowed", () => {
  const dept = ["p/A", "p/B", "p/C"];

  it("unions a user's own models with the ones their groups grant", () => {
    // 组是授予：多一个组只会多一份模型，不会让范围变小。
    expect(
      computeEffectiveUserAllowed(dept, mergeAssignedModelIds(["p/C"], ["p/A", "p/B"])),
    ).toEqual(["p/A", "p/B", "p/C"]);
  });

  it("clips the union to the department ceiling", () => {
    expect(
      computeEffectiveUserAllowed(dept, mergeAssignedModelIds(["p/A"], ["outside/X"])),
    ).toEqual(["p/A"]);
  });

  it("lets the user turn off a model they were granted", () => {
    expect(
      computeEffectiveUserAllowed(dept, mergeAssignedModelIds(["p/A", "p/C"], ["p/A", "p/B"]), [
        "p/A",
      ]),
    ).toEqual(["p/B", "p/C"]);
  });

  it("distinguishes no assignment from an empty one", () => {
    // null = 没配过，继承部门全集；空数组 = 明确一个都不给。
    expect(computeEffectiveUserAllowed(dept, mergeAssignedModelIds(null, []))).toEqual(dept);
    expect(computeEffectiveUserAllowed(dept, [])).toEqual([]);
  });

  it("keeps the personal set narrowing when the user is in no group", () => {
    // 不在任何组时的行为必须和统一之前完全一致，否则这是一次静默的权限变更。
    expect(computeEffectiveUserAllowed(dept, mergeAssignedModelIds(["p/B"], []))).toEqual(["p/B"]);
  });
});
