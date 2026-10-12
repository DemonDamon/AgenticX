import { describe, expect, it } from "vitest";
import { STREAMING_FACE_CYCLE, resolveNearBuddyMood } from "./near-buddy-mood";

describe("resolveNearBuddyMood", () => {
  it("uses working while the run is streaming", () => {
    expect(resolveNearBuddyMood({ streaming: true, composerHasText: true, composerFocused: true })).toBe(
      "working",
    );
  });

  it("listens when the composer has text", () => {
    expect(resolveNearBuddyMood({ composerHasText: true })).toBe("listening");
  });

  it("looks curious on an empty focused composer", () => {
    expect(resolveNearBuddyMood({ composerFocused: true })).toBe("curious");
  });

  it("rests when idle", () => {
    expect(resolveNearBuddyMood({})).toBe("rest");
  });

  it("cycles distinct faces while working, not a single pause-bar", () => {
    expect(STREAMING_FACE_CYCLE.length).toBeGreaterThanOrEqual(6);
    expect(new Set(STREAMING_FACE_CYCLE).size).toBe(STREAMING_FACE_CYCLE.length);
    expect(STREAMING_FACE_CYCLE).not.toContain("working");
  });
});
