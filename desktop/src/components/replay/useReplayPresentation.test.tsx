// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayEvent, ReplayEventsResponse } from "./replay-types";
import { useReplayStore } from "./replay-store";
import { useReplayPresentation } from "./useReplayPresentation";

function event(seq: number, type: string): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    ts: seq * 1_000,
    type,
    agentId: "meta",
    title: type,
    summary: "",
    effectClass: "none",
    branchable: false,
  };
}

function page(events: ReplayEvent[]): ReplayEventsResponse {
  return {
    run: {
      runId: "run-1",
      sessionId: "session-1",
      turnId: "turn-1",
      agentId: "meta",
      status: "completed",
      createdAt: 1_000,
      eventCount: events.length,
      completeness: "complete",
    },
    events,
    nextSeq: events.at(-1)?.seq ?? 0,
    hasMore: false,
    parseWarnings: [],
  };
}

function Probe({ onRender }: { onRender: (count: number) => void }) {
  const count = useRef(0);
  count.current += 1;
  onRender(count.current);
  const slice = useReplayPresentation("pane-a");
  return <div>{slice.presenting ? slice.cursorSeq : "idle"}</div>;
}

describe("useReplayPresentation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReplayStore.getState().resetAll();
  });

  it("does not loop when presentation starts", async () => {
    const renders: number[] = [];
    render(<Probe onRender={(count) => { renders.push(count); }} />);
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([
        event(1, "run_started"),
        event(2, "user_message"),
        event(3, "tool_call"),
      ]),
    );

    await act(async () => {
      await useReplayStore.getState().enterPresentation("pane-a");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useReplayStore.getState().getPane("pane-a").presenting).toBe(true);
    expect(Math.max(...renders)).toBeLessThan(20);
  });
});
