import { describe, expect, it } from "vitest";

import {
  formatToolElapsedSeconds,
  normalizeToolElapsedSeconds,
} from "./tool-elapsed-timer";

describe("tool elapsed timer helpers", () => {
  it("normalizes invalid and fractional values", () => {
    expect(normalizeToolElapsedSeconds(undefined)).toBe(0);
    expect(normalizeToolElapsedSeconds(-2)).toBe(0);
    expect(normalizeToolElapsedSeconds(4.9)).toBe(4);
  });

  it("formats short and long tool durations compactly", () => {
    expect(formatToolElapsedSeconds(9)).toBe("9s");
    expect(formatToolElapsedSeconds(65)).toBe("1m 05s");
  });
});
