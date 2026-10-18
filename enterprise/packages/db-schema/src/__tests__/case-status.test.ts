import { describe, expect, it } from "vitest";
import { canTransitionCase } from "../case-status";

describe("case library transitions", () => {
  it("requires review and archive before a case is published", () => {
    expect(canTransitionCase("submitted", "reviewing")).toBe(true);
    expect(canTransitionCase("submitted", "published")).toBe(false);
    expect(canTransitionCase("reviewing", "archived")).toBe(true);
    expect(canTransitionCase("reviewing", "submitted")).toBe(true);
    expect(canTransitionCase("archived", "published")).toBe(true);
    expect(canTransitionCase("published", "archived")).toBe(false);
  });
});
