import { describe, expect, it } from "vitest";
import type { ToolStep } from "./graph-types";
import { deriveTimelineWindow, deriveToolSpans } from "./span-derive";

function step(overrides?: Partial<ToolStep>): ToolStep {
  return {
    callId: "c1",
    toolName: "list_files",
    phase: "calling",
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("deriveToolSpans", () => {
  it("maps calling then done into one closed span with done updatedAt", () => {
    // applyToolStepToState merges calling→done into one ToolStep; derive sees the final step.
    const spans = deriveToolSpans([
      step({ callId: "c1", phase: "done", startedAt: 1000, updatedAt: 2500 }),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      callId: "c1",
      startMs: 1000,
      endMs: 2500,
      running: false,
    });
  });

  it("keeps overlapping spans separate", () => {
    const spans = deriveToolSpans([
      step({ callId: "a", phase: "done", startedAt: 1000, updatedAt: 3000 }),
      step({ callId: "b", phase: "done", startedAt: 2000, updatedAt: 4000, toolName: "file_read" }),
    ]);
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.callId)).toEqual(["a", "b"]);
    expect(spans[0]!.startMs).toBeLessThan(spans[1]!.endMs!);
    expect(spans[1]!.startMs).toBeLessThan(spans[0]!.endMs!);
  });

  it("skips steps with non-finite startedAt", () => {
    const spans = deriveToolSpans([
      step({ callId: "bad", startedAt: Number.NaN, updatedAt: 2000, phase: "done" }),
      step({ callId: "ok", startedAt: 1000, updatedAt: 2000, phase: "done" }),
    ]);
    expect(spans.map((s) => s.callId)).toEqual(["ok"]);
  });

  it("leaves calling spans open (no endMs)", () => {
    const spans = deriveToolSpans([step({ phase: "calling", startedAt: 1000, updatedAt: 1500 })]);
    expect(spans).toEqual([
      {
        callId: "c1",
        toolName: "list_files",
        startMs: 1000,
        endMs: undefined,
        running: true,
      },
    ]);
  });

  it("clamps endMs when updatedAt is before startedAt", () => {
    const spans = deriveToolSpans([
      step({ phase: "done", startedAt: 5000, updatedAt: 4000 }),
    ]);
    expect(spans[0]?.endMs).toBe(5000);
  });
});

describe("deriveTimelineWindow", () => {
  it("returns null for empty spans", () => {
    expect(deriveTimelineWindow([], 9999)).toBeNull();
  });

  it("uses nowMs as end when a running span exists", () => {
    const spans = deriveToolSpans([step({ phase: "calling", startedAt: 1000, updatedAt: 1000 })]);
    expect(deriveTimelineWindow(spans, 5555)).toEqual({ startMs: 1000, endMs: 5555 });
  });

  it("pads zero-width window by 1000ms", () => {
    const spans = deriveToolSpans([
      step({ phase: "done", startedAt: 2000, updatedAt: 2000 }),
    ]);
    expect(deriveTimelineWindow(spans, 9999)).toEqual({ startMs: 2000, endMs: 3000 });
  });
});
