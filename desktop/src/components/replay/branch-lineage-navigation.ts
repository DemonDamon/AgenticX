import type { BranchLineage } from "../../utils/session-message-map";

export type ReplayLineageTarget = {
  kind: "timeline";
  sessionId: string;
  runId: string;
  eventId: string;
};

export function replayFocusForBranchLineage(
  lineage: BranchLineage,
): ReplayLineageTarget {
  const runId = lineage.parentRunId.trim();
  const eventId = lineage.sourceEventId?.trim() ?? "";
  if (!runId) throw new Error("source_run_unavailable");
  if (!eventId) throw new Error("source_event_unavailable");
  return {
    kind: "timeline",
    sessionId: lineage.parentSessionId,
    runId,
    eventId,
  };
}

export function replayFocusTargetForSession(
  target: ReplayLineageTarget | null,
  sessionId: string,
): ReplayLineageTarget | undefined {
  return target?.sessionId === sessionId ? target : undefined;
}
