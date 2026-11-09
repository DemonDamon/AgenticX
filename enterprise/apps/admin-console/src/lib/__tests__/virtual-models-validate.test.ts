import { describe, expect, it } from "vitest";

import { validateVirtualModelInput } from "../virtual-models-shared";

const valid = {
  name: "team-default",
  displayName: "团队默认",
  enabled: true,
  targets: [{ model: "gpt-4o-mini", weight: 1, priority: 0 }],
};

describe("validateVirtualModelInput", () => {
  it("accepts a name, display name, and weighted targets", () => {
    expect(validateVirtualModelInput(valid)).toEqual(valid);
  });

  it("rejects a name that contains a slash", () => {
    expect(() => validateVirtualModelInput({ ...valid, name: "provider/model" })).toThrow(/name is invalid/);
  });

  it("rejects an empty target list and a non-positive weight", () => {
    expect(() => validateVirtualModelInput({ ...valid, targets: [] })).toThrow(/targets is invalid/);
    expect(() =>
      validateVirtualModelInput({
        ...valid,
        targets: [{ model: "gpt-4o-mini", weight: 0, priority: 0 }],
      }),
    ).toThrow(/targets is invalid/);
  });
});
