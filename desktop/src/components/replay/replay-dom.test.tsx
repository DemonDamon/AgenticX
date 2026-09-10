// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { ExecutionTimeline } from "../graph/ExecutionTimeline";
import { useGraphRunStore } from "../graph/useGraphRun";
import {
  listReplayEvents,
  listReplayRuns,
} from "./replay-api";
import { ReplayEventDetail } from "./ReplayEventDetail";
import { buildReplayPayloadDisplay } from "./replay-payload";
import { ReplaySummaryBar } from "./ReplaySummaryBar";
import { ReplayTimeline } from "./ReplayTimeline";
import { RunReplayPanel } from "./RunReplayPanel";
import { useReplayStore } from "./replay-store";
import type {
  ReplayEvent,
  ReplayEventsResponse,
  ReplayRun,
  ReplayRunsResponse,
} from "./replay-types";

vi.mock("./replay-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./replay-api")>();
  return {
    ...actual,
    listReplayEvents: vi.fn(),
    listReplayRuns: vi.fn(),
  };
});

const run: ReplayRun = {
  runId: "run-1",
  sessionId: "session-1",
  turnId: "turn-1",
  agentId: "meta",
  status: "completed",
  createdAt: 1_000,
  completedAt: 3_000,
  eventCount: 2,
  completeness: "complete",
};

function replayEvent(seq: number): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    ts: seq * 1_000,
    type: "round_started",
    agentId: "meta",
    title: `event ${seq}`,
    summary: "",
    effectClass: "none",
    branchable: false,
  };
}

function eventsPage(
  events: ReplayEvent[],
  status: ReplayRun["status"] = "completed",
  hasMore = false,
  eventCount = events.length,
): ReplayEventsResponse {
  return {
    run: { ...run, status, eventCount },
    events,
    nextSeq: events.at(-1)?.seq ?? 0,
    hasMore,
    parseWarnings: [],
  };
}

function runsResponse(runs: ReplayRun[]): ReplayRunsResponse {
  return { runs, legacy: false, parseWarnings: [] };
}

function panel(
  sessionId = "session-1",
  paneId = "pane-a",
  focusTarget?: { runId: string; eventId: string },
) {
  return (
    <I18nextProvider i18n={i18n}>
      <RunReplayPanel
        paneId={paneId}
        sessionId={sessionId}
        apiBase="http://localhost:8000"
        apiToken="secret"
        avatarById={new Map()}
        agentIds={["meta"]}
        metaLeaderLabel="Meta Test"
        focusTarget={focusTarget}
      />
    </I18nextProvider>
  );
}

function SparseTimelineHarness() {
  const [cursorSeq, setCursorSeq] = useState(2);
  const events = [replayEvent(2), replayEvent(10), replayEvent(30)];
  return (
    <I18nextProvider i18n={i18n}>
      <ReplayTimeline
        events={events}
        rangeFirstSeq={2}
        rangeLastSeq={30}
        rangeFirstTs={2_000}
        cursorSeq={cursorSeq}
        selectedEventId="event-2"
        avatarById={new Map()}
        metaLeaderLabel="Meta Test"
        onSeek={setCursorSeq}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
      />
    </I18nextProvider>
  );
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("replay mounted behavior", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    useReplayStore.getState().resetAll();
    useGraphRunStore.setState({ byPane: {} });
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes the run list every two seconds and stops after unmount", async () => {
    vi.mocked(listReplayRuns)
      .mockResolvedValueOnce(runsResponse([]))
      .mockResolvedValue(runsResponse([run]));
    vi.mocked(listReplayEvents).mockResolvedValue(eventsPage([replayEvent(1), replayEvent(2)]));

    const view = render(panel());
    await flushEffects();
    expect(screen.getByText("当前会话暂无可回放运行")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flushEffects();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(listReplayRuns).toHaveBeenCalledTimes(2);

    view.unmount();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(listReplayRuns).toHaveBeenCalledTimes(2);
  });

  it("loads pages until a lineage source event is selected", async () => {
    const running = { ...run, status: "running" as const, eventCount: 101 };
    vi.mocked(listReplayRuns).mockResolvedValue(runsResponse([running]));
    vi.mocked(listReplayEvents)
      .mockResolvedValueOnce(eventsPage(
        [replayEvent(1)],
        "running",
        true,
        101,
      ))
      .mockResolvedValueOnce(eventsPage(
        [replayEvent(101)],
        "running",
        false,
        101,
      ));

    render(panel(
      "session-1",
      "pane-lineage",
      { runId: "run-1", eventId: "event-101" },
    ));
    await flushEffects();
    await flushEffects();

    expect(listReplayEvents).toHaveBeenCalledTimes(2);
    expect(useReplayStore.getState().getPane("pane-lineage").selectedEventId)
      .toBe("event-101");
  });

  it("lets a run-list request exceed multiple ticks without aborting or duplicating it", async () => {
    let resolveSlow!: (value: ReplayRunsResponse) => void;
    let slowSignal: AbortSignal | undefined;
    const slowResponse = new Promise<ReplayRunsResponse>((resolve) => {
      resolveSlow = resolve;
    });
    vi.mocked(listReplayRuns)
      .mockImplementationOnce(async (_apiBase, _apiToken, _sessionId, options) => {
        slowSignal = options?.signal;
        return await slowResponse;
      })
      .mockResolvedValue(runsResponse([run]));
    vi.mocked(listReplayEvents).mockResolvedValue(eventsPage([replayEvent(1), replayEvent(2)]));

    render(panel("session-1", "pane-slow-list"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(listReplayRuns).toHaveBeenCalledOnce();
    expect(slowSignal?.aborted).toBe(false);

    await act(async () => {
      resolveSlow(runsResponse([run]));
      await Promise.resolve();
    });
    await flushEffects();
    expect(screen.getByText("已完成")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(listReplayRuns).toHaveBeenCalledTimes(2);
  });

  it("aborts run-list requests and resets playback when session changes", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(listReplayRuns).mockImplementation(
      async (_apiBase, _apiToken, _sessionId, options) => await new Promise<ReplayRunsResponse>(
        () => {
          if (options?.signal) signals.push(options.signal);
        },
      ),
    );

    const view = render(panel("session-1", "pane-session"));
    await flushEffects();
    await act(async () => {
      await useReplayStore.getState().openRun(
        "pane-session",
        "session-1",
        "run-1",
        async () => eventsPage([replayEvent(1), replayEvent(2)]),
      );
      useReplayStore.getState().play("pane-session");
    });

    view.rerender(panel("session-2", "pane-session"));
    await flushEffects();
    expect(signals[0]?.aborted).toBe(true);
    expect(useReplayStore.getState().getPane("pane-session")).toMatchObject({
      runId: null,
      playing: false,
      cursorSeq: 0,
    });

    view.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("clears a transient running-poll error and finishes terminal pagination", async () => {
    let terminal = false;
    vi.mocked(listReplayRuns).mockImplementation(async () => runsResponse([
      { ...run, status: terminal ? "completed" : "running", eventCount: 3 },
    ]));
    let afterOneCalls = 0;
    vi.mocked(listReplayEvents).mockImplementation(async (
      _apiBase,
      _apiToken,
      _runId,
      options,
    ) => {
      if ((options?.afterSeq ?? 0) === 0) {
        return eventsPage([replayEvent(1)], "running", true, 3);
      }
      if (options?.afterSeq === 1) {
        afterOneCalls += 1;
        if (afterOneCalls === 1) throw new Error("poll failed");
        terminal = true;
        return eventsPage([replayEvent(2)], "completed", true, 3);
      }
      return eventsPage([replayEvent(3)], "completed", false, 3);
    });

    render(panel("session-1", "pane-poll"));
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flushEffects();
    expect(screen.getByText("poll failed")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flushEffects();
    expect(screen.queryByText("poll failed")).toBeNull();
    expect(useReplayStore.getState().getPane("pane-poll")).toMatchObject({
      hasMore: false,
      error: null,
    });
    expect(useReplayStore.getState().getPane("pane-poll").events).toHaveLength(3);
  });

  it("does not route event-row keyboard shortcuts to the timeline or its parent", () => {
    const toggle = vi.fn();
    const step = vi.fn();
    const parentKeyDown = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <div onKeyDown={parentKeyDown}>
          <ReplayTimeline
            events={[replayEvent(1), replayEvent(2)]}
            rangeFirstSeq={1}
            rangeLastSeq={2}
            rangeFirstTs={1_000}
            cursorSeq={2}
            selectedEventId={null}
            avatarById={new Map()}
            metaLeaderLabel="Meta Test"
            onSeek={() => {}}
            onSelect={() => {}}
            onTogglePlay={toggle}
            onStep={step}
          />
        </div>
      </I18nextProvider>,
    );
    const row = screen.getByRole("button", { name: "回放步骤 #1" });
    row.focus();

    for (const key of [" ", "Home", "End"]) fireEvent.keyDown(row, { key });

    expect(toggle).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("marks the greatest sparse sequence at or before a dragged cursor as current", () => {
    render(<SparseTimelineHarness />);
    const scrubber = screen.getByRole("slider", { name: "拖动回放进度" });

    fireEvent.change(scrubber, { target: { value: "20" } });

    const cursorRow = screen.getByRole("button", { name: "回放步骤 #10" });
    const selectedRow = screen.getByRole("button", { name: "回放步骤 #2" });
    expect(cursorRow.getAttribute("aria-current")).toBe("step");
    expect(cursorRow.className).toContain("bg-surface-card");
    expect(selectedRow.getAttribute("aria-current")).toBeNull();
    expect(selectedRow.className).toContain("bg-surface-card-strong");
  });

  it("moves aria-current with playback across sparse sequences", async () => {
    vi.mocked(listReplayRuns).mockResolvedValue(runsResponse([
      { ...run, eventCount: 3 },
    ]));
    vi.mocked(listReplayEvents).mockResolvedValue(eventsPage([
      replayEvent(2),
      replayEvent(10),
      replayEvent(30),
    ]));
    render(panel("session-1", "pane-playback"));
    await flushEffects();
    expect(screen.getByRole("button", { name: "回放步骤 #2" }).getAttribute("aria-current"))
      .toBe("step");

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(screen.getByRole("button", { name: "回放步骤 #10" }).getAttribute("aria-current"))
      .toBe("step");
    expect(screen.getByRole("button", { name: "回放步骤 #2" }).getAttribute("aria-current"))
      .toBeNull();
  });

  it("keeps two mounted panes on the same run independently selectable", async () => {
    vi.mocked(listReplayRuns).mockResolvedValue(runsResponse([run]));
    vi.mocked(listReplayEvents).mockResolvedValue(eventsPage([replayEvent(1), replayEvent(2)]));
    render(
      <div>
        <section data-testid="pane-a">{panel("session-1", "pane-a")}</section>
        <section data-testid="pane-b">{panel("session-1", "pane-b")}</section>
      </div>,
    );
    await flushEffects();
    act(() => useReplayStore.getState().seek("pane-a", 2));
    fireEvent.click(within(screen.getByTestId("pane-a")).getByRole(
      "button",
      { name: "回放步骤 #2" },
    ));

    expect(useReplayStore.getState().getPane("pane-a").selectedEventId).toBe("event-2");
    expect(useReplayStore.getState().getPane("pane-b").selectedEventId).toBeNull();
  });

  it("renders precomputed bounded payload text with an honest truncation notice", () => {
    const payloadDisplay = buildReplayPayloadDisplay({
      output: "x".repeat(32 * 1024 * 1024),
    });
    render(
      <I18nextProvider i18n={i18n}>
        <ReplayEventDetail
          event={replayEvent(1)}
          payloadDisplay={payloadDisplay}
          payloadLoading={false}
          payloadError={null}
          onLoadPayload={() => {}}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("内容超过 256 KiB，已截断显示。")).toBeTruthy();
    expect(new TextEncoder().encode(payloadDisplay.displayText).byteLength)
      .toBeLessThanOrEqual(256 * 1024);
  });

  it("uses the resolved i18n language for replay summary dates", async () => {
    await i18n.changeLanguage("en");
    const format = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("localized date");
    render(
      <I18nextProvider i18n={i18n}>
        <ReplaySummaryBar
          runs={[run, { ...run, runId: "run-2", createdAt: 2_000 }]}
          selectedRunId={run.runId}
          stats={{ durationMs: 0, rounds: 0, toolCalls: 0, errors: 0, subagents: 0, branches: 0 }}
          summarizing={false}
          onSelectRun={() => {}}
        />
      </I18nextProvider>,
    );

    expect(format).toHaveBeenCalledWith("en-US");
  });

  it("mounts ExecutionTimeline without ledger-committed call ids", () => {
    const graph = useGraphRunStore.getState();
    for (const callId of ["excluded-call", "visible-call"]) {
      graph.applyToolStep("pane-graph", "agent:a1", {
        callId,
        toolName: callId,
        phase: "calling",
        startedAt: 1_000,
        updatedAt: 1_000,
      });
      graph.applyToolStep("pane-graph", "agent:a1", {
        callId,
        toolName: callId,
        phase: "done",
        startedAt: 1_000,
        updatedAt: 2_000,
      });
    }
    render(
      <I18nextProvider i18n={i18n}>
        <ExecutionTimeline
          paneId="pane-graph"
          agentIds={["a1"]}
          avatarById={new Map()}
          excludeCallIds={new Set(["excluded-call"])}
        />
      </I18nextProvider>,
    );

    expect(screen.queryAllByTitle(/excluded-call/)).toHaveLength(0);
    expect(screen.queryAllByTitle(/visible-call/).length).toBeGreaterThan(0);
  });
});
