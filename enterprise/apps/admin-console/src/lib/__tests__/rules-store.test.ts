import { describe, expect, it } from "vitest";
import { SAMPLE_RULES } from "../rules-types";

describe("rules seed", () => {
  it("uses desensitized cooling-loop sample ids only", () => {
    expect(SAMPLE_RULES.length).toBeGreaterThan(0);
    const blob = JSON.stringify(SAMPLE_RULES).toLowerCase();
    expect(blob).toContain("cooling-loop");
    expect(blob).not.toContain("proposal");
  });
});
