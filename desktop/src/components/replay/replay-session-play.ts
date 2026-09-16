import type { ReplayEvent, ReplayRun } from "./replay-types";

export const SESSION_PLAY_ID = "__session__";

const TERMINAL_RUN = new Set<ReplayRun["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isSessionPlayId(runId: string | null | undefined): boolean {
  return runId === SESSION_PLAY_ID;
}

export function presentableSessionRuns(runs: readonly ReplayRun[]): ReplayRun[] {
  return [...runs]
    .filter((run) => TERMINAL_RUN.has(run.status))
    .sort((left, right) => (
      left.createdAt !== right.createdAt
        ? left.createdAt - right.createdAt
        : left.runId.localeCompare(right.runId)
    ));
}

export function canOfferSessionPlay(runs: readonly ReplayRun[]): boolean {
  return presentableSessionRuns(runs).length >= 2;
}

export function preferredReplayRun(runs: readonly ReplayRun[]): ReplayRun | undefined {
  const newestFirst = [...runs].sort((left, right) => right.createdAt - left.createdAt);
  return newestFirst.find((run) => run.status === "running")
    ?? newestFirst.find((run) => run.status === "completed")
    ?? newestFirst[0];
}

export function retainReplaySelection(
  current: string,
  runs: readonly ReplayRun[],
  focusRunId?: string,
): string {
  // `__session__` is not a real runId. A 2s run-list poll must not treat it as
  // stale and snap back to the newest completed run.
  if (isSessionPlayId(current) && canOfferSessionPlay(runs)) return current;
  if (focusRunId && runs.some((run) => run.runId === focusRunId)) return focusRunId;
  if (runs.some((run) => run.runId === current)) return current;
  return preferredReplayRun(runs)?.runId ?? "";
}

export function mergeSessionReplay(
  parts: readonly { run: ReplayRun; events: readonly ReplayEvent[] }[],
): { run: ReplayRun; events: ReplayEvent[] } {
  const ordered = [...parts].sort((left, right) => (
    left.run.createdAt !== right.run.createdAt
      ? left.run.createdAt - right.run.createdAt
      : left.run.runId.localeCompare(right.run.runId)
  ));
  const events: ReplayEvent[] = [];
  let offset = 0;
  for (const part of ordered) {
    const rows = [...part.events].sort((left, right) => left.seq - right.seq);
    for (const event of rows) {
      events.push({ ...event, seq: event.seq + offset });
    }
    offset += rows.at(-1)?.seq ?? 0;
  }
  const first = ordered[0]?.run;
  const last = ordered.at(-1)?.run;
  if (!first || !last) {
    return {
      run: {
        runId: SESSION_PLAY_ID,
        sessionId: "",
        turnId: "session",
        agentId: "meta",
        status: "completed",
        createdAt: 0,
        eventCount: 0,
        completeness: "complete",
      },
      events,
    };
  }
  return {
    run: {
      runId: SESSION_PLAY_ID,
      sessionId: first.sessionId,
      turnId: "session",
      agentId: first.agentId,
      status: "completed",
      createdAt: first.createdAt,
      completedAt: last.completedAt,
      eventCount: events.length,
      branchCount: ordered.reduce((sum, part) => sum + (part.run.branchCount ?? 0), 0),
      completeness: ordered.some((part) => part.run.completeness === "partial")
        ? "partial"
        : "complete",
    },
    events,
  };
}
