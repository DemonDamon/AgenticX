import { describe, expect, it } from "vitest";
import {
  formatReasoningTitle,
  getCachedReasoningDuration,
  measureReasoningSeconds,
  setCachedReasoningDuration,
} from "./reasoning-duration";

describe("reasoning duration", () => {
  it("formats live, completed, and unknown durations without inventing one second", () => {
    expect(
      formatReasoningTitle({
        thinkingInProgress: true,
        elapsedSeconds: 3,
        hasReliableDuration: true,
      }),
    ).toBe("思考中（3 秒）");
    expect(
      formatReasoningTitle({
        thinkingInProgress: false,
        elapsedSeconds: 5,
        hasReliableDuration: true,
      }),
    ).toBe("思考了 5 秒");
    expect(
      formatReasoningTitle({
        thinkingInProgress: false,
        elapsedSeconds: 0,
        hasReliableDuration: false,
      }),
    ).toBe("思考过程");
  });

  it("keeps a completed duration when a streaming cleanup arrives later", () => {
    const key = "assistant-completed";
    setCachedReasoningDuration(key, 7, true);
    setCachedReasoningDuration(key, 3, false);
    expect(getCachedReasoningDuration(key)).toEqual({ seconds: 7, completed: true });
  });

  it("rounds elapsed time to at least one second", () => {
    expect(measureReasoningSeconds(0, 400)).toBe(1);
    expect(measureReasoningSeconds(0, 2_600)).toBe(3);
  });
});
