/**
 * Author: Damon Li
 */
import { describe, expect, it } from "vitest";
import {
  joinStreamSegments,
  nextPacedCount,
  pacedRevealStep,
  segmentStreamText,
} from "./streaming-text";

describe("segmentStreamText", () => {
  it("keeps latin words and spaces as separate segments", () => {
    const parts = segmentStreamText("Hello world");
    expect(parts.join("")).toBe("Hello world");
    expect(parts.length).toBeGreaterThan(1);
  });

  it("splits CJK so a dump can be paced", () => {
    const parts = segmentStreamText("建议采用方案");
    expect(parts.join("")).toBe("建议采用方案");
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe("pacedRevealStep", () => {
  it("walks one segment when the backlog is small", () => {
    expect(pacedRevealStep(1)).toBe(1);
    expect(pacedRevealStep(8)).toBe(1);
  });

  it("catches up when a large dump arrives at once", () => {
    expect(pacedRevealStep(40)).toBe(2);
    expect(pacedRevealStep(200)).toBeGreaterThan(2);
  });
});

describe("joinStreamSegments / nextPacedCount", () => {
  it("rebuilds the original prefix", () => {
    const parts = ["建", "议", "采用"];
    expect(joinStreamSegments(parts, 2)).toBe("建议");
    expect(joinStreamSegments(parts, 0)).toBe("");
    expect(joinStreamSegments(parts, 9)).toBe("建议采用");
  });

  it("advances toward the full reply", () => {
    expect(nextPacedCount(1, 5)).toBe(2);
    expect(nextPacedCount(5, 5)).toBe(5);
    expect(nextPacedCount(0, 0)).toBe(0);
  });
});
