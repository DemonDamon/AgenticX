import { describe, expect, it } from "vitest";
import { isDoubleEnterWithinWindow, shouldEnqueueOnResend } from "./message-queue";

describe("message-queue", () => {
  it("enqueues while stream is active unless forceSend", () => {
    expect(shouldEnqueueOnResend({ isStreamActive: true })).toBe(true);
    expect(shouldEnqueueOnResend({ isStreamActive: true, forceSend: true })).toBe(false);
    expect(shouldEnqueueOnResend({ isStreamActive: false })).toBe(false);
  });

  it("detects double Enter within window", () => {
    const now = 1_000_000;
    expect(isDoubleEnterWithinWindow(now - 200, now)).toBe(true);
    expect(isDoubleEnterWithinWindow(now - 500, now)).toBe(false);
  });
});
