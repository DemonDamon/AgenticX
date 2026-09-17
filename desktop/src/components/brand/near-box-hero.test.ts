import { describe, expect, it } from "vitest";
import { nextNearBoxIdleMood, NEAR_BOX_IDLE_MOODS, resolveNearBoxMood } from "./near-box-hero";

describe("near-box-hero mood", () => {
  it("uses the demo playlist while idle", () => {
    expect(NEAR_BOX_IDLE_MOODS).toEqual([
      "curious",
      "proud",
      "happy",
      "laughing",
      "listening",
      "surprised",
      "sleeping",
    ]);
    expect(nextNearBoxIdleMood("curious")).toBe("proud");
    expect(nextNearBoxIdleMood("sleeping")).toBe("curious");
  });

  it("switches to excited on hover", () => {
    expect(resolveNearBoxMood({ hovered: true, idle: "listening" })).toBe("excited");
    expect(resolveNearBoxMood({ hovered: false, idle: "listening" })).toBe("listening");
  });
});
