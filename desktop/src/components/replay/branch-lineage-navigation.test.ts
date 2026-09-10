import { describe, expect, it } from "vitest";
import {
  replayFocusForBranchLineage,
  replayFocusTargetForSession,
  type ReplayLineageTarget,
} from "./branch-lineage-navigation";

describe("branch lineage replay navigation", () => {
  it("carries the persisted parent run and source event after cold restore", () => {
    const target: ReplayLineageTarget = replayFocusForBranchLineage({
      parentSessionId: "source-session",
      parentRunId: "parent-run",
      requestedSeq: 101,
      restoredSeq: 100,
      sourceEventId: "event-101",
    });

    expect(target).toEqual({
      kind: "timeline",
      sessionId: "source-session",
      runId: "parent-run",
      eventId: "event-101",
    });
  });

  it("reports a missing source event instead of opening an ambiguous run", () => {
    expect(() => replayFocusForBranchLineage({
      parentSessionId: "source-session",
      parentRunId: "parent-run",
      requestedSeq: 101,
      restoredSeq: 100,
    })).toThrow("source_event_unavailable");
  });

  it("does not apply a stale lineage target to a later session", () => {
    const target = replayFocusForBranchLineage({
      parentSessionId: "source-session",
      parentRunId: "parent-run",
      requestedSeq: 101,
      restoredSeq: 100,
      sourceEventId: "event-101",
    });

    expect(replayFocusTargetForSession(target, "source-session")).toBe(target);
    expect(replayFocusTargetForSession(target, "other-session")).toBeUndefined();
  });
});
