import { describe, expect, it } from "vitest";

import { computeEffectiveUserAllowed } from "./effective-models";

describe("computeEffectiveUserAllowed", () => {
  it("adds a user's allowed extras to models inherited from a group", () => {
    expect(computeEffectiveUserAllowed(["p/A", "p/B", "p/C"], ["p/C"], ["p/A", "p/B"])).toEqual([
      "p/A",
      "p/B",
      "p/C",
    ]);
  });

  it("keeps the existing direct-user behavior when no group model baseline exists", () => {
    expect(computeEffectiveUserAllowed(["p/A", "p/B"], null)).toEqual(["p/A", "p/B"]);
    expect(computeEffectiveUserAllowed(["p/A", "p/B"], ["p/B"])).toEqual(["p/B"]);
  });
});
