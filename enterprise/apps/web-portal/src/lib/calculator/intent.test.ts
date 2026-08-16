import { describe, expect, it } from "vitest";
import { allowsEvidencePlanning, parseCalculationIntent } from "./intent";

describe("calculation intent", () => {
  it("reads the three states the agents may state", () => {
    expect(parseCalculationIntent({ calculation_intent: "needed" })).toBe("needed");
    expect(parseCalculationIntent({ calculation_intent: "not_needed" })).toBe("not_needed");
    expect(parseCalculationIntent({ calculation_intent: "uncertain" })).toBe("uncertain");
  });

  it("treats anything else as uncertain rather than as a decision", () => {
    // An older gateway, a model that dropped the field, a boolean from someone
    // who thought two states were enough, a string in the wrong case. None of
    // these is a statement that arithmetic is unnecessary.
    for (const value of [
      {},
      { calculation_intent: undefined },
      { calculation_intent: null },
      { calculation_intent: false },
      { calculation_intent: true },
      { calculation_intent: "NOT_NEEDED" },
      { calculation_intent: "no" },
      { calculation_intent: 0 },
      { calculation_intent: ["needed"] },
      null,
      undefined,
      "not_needed",
      ["not_needed"],
      42,
    ]) {
      expect(parseCalculationIntent(value)).toBe("uncertain");
    }
  });

  it("only an explicit not_needed skips the evidence pass", () => {
    expect(allowsEvidencePlanning("needed")).toBe(true);
    expect(allowsEvidencePlanning("uncertain")).toBe(true);
    expect(allowsEvidencePlanning("not_needed")).toBe(false);
  });
});
