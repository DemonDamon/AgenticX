import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayStore } from "./replay-store";
import type { ReplayEvent, ReplayEventsResponse } from "./replay-types";

function event(seq: number, ts: number = seq * 1_000): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    ts,
    type: "round_started",
    agentId: "meta",
    title: `event ${seq}`,
    summary: "",
    effectClass: "none",
    branchable: false,
  };
}

function page(events: ReplayEvent[], runId = "run-1"): ReplayEventsResponse {
  return {
    run: {
      runId,
      sessionId: "session-1",
      turnId: "turn-1",
      agentId: "meta",
      status: "running",
      createdAt: 1_000,
      eventCount: events.length,
      completeness: "complete",
    },
    events: events.map((item) => ({ ...item, runId })),
    nextSeq: events.at(-1)?.seq ?? 0,
    hasMore: false,
    parseWarnings: [],
  };
}

function pagedResponse(
  allEvents: ReplayEvent[],
  afterSeq: number,
  pageSize: number,
  runId = "run-1",
): ReplayEventsResponse {
  const events = allEvents.filter((item) => item.seq > afterSeq).slice(0, pageSize);
  const nextSeq = events.at(-1)?.seq ?? afterSeq;
  return {
    ...page(events, runId),
    run: {
      ...page(events, runId).run,
      status: "completed",
      eventCount: allEvents.length,
    },
    nextSeq,
    hasMore: nextSeq < (allEvents.at(-1)?.seq ?? 0),
  };
}

describe("replay pane store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    useReplayStore.getState().resetAll();
  });

  it.each([
    [0.5, 1_500],
    [1, 1_000],
    [2, 500],
  ] as const)("advances playback at %s speed", async (speed, delay) => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1, 0), event(2, 1_000)]),
    );
    useReplayStore.getState().setSpeed("pane-a", speed);
    useReplayStore.getState().play("pane-a");

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(2);
    expect(useReplayStore.getState().getPane("pane-a").playing).toBe(false);
  });

  it("advances instant playback by at most 100 events per frame", async () => {
    const events = Array.from({ length: 205 }, (_, index) => event(index + 1, index));
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page(events),
    );
    useReplayStore.getState().setSpeed("pane-a", "instant");
    useReplayStore.getState().play("pane-a");

    await vi.advanceTimersByTimeAsync(16);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(101);
    await vi.advanceTimersByTimeAsync(32);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(205);
  });

  it("uses animation frames for instant playback when available", async () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      return setTimeout(() => callback(0), 16) as unknown as number;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1), event(2)]),
    );
    useReplayStore.getState().setSpeed("pane-a", "instant");
    useReplayStore.getState().play("pane-a");

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("pauses immediately when seeking", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1), event(2), event(3)]),
    );
    useReplayStore.getState().play("pane-a");
    useReplayStore.getState().seek("pane-a", 2);

    expect(useReplayStore.getState().getPane("pane-a")).toMatchObject({
      cursorSeq: 2,
      playing: false,
    });
    await vi.runAllTimersAsync();
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(2);
  });

  it("clears a selected future detail when the cursor seeks behind it", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1), event(2), event(3)]),
    );
    useReplayStore.getState().selectEvent("pane-a", "event-3");
    useReplayStore.getState().seek("pane-a", 1);

    expect(useReplayStore.getState().getPane("pane-a").selectedEventId).toBeNull();
  });

  it("ignores an old request that resolves after switching runs", async () => {
    let resolveOld: ((value: ReplayEventsResponse) => void) | undefined;
    const oldRequest = new Promise<ReplayEventsResponse>((resolve) => {
      resolveOld = resolve;
    });
    const first = useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-old",
      async () => oldRequest,
    );
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-new",
      async () => page([event(9)], "run-new"),
    );
    resolveOld?.(page([event(1)], "run-old"));
    await first;

    const state = useReplayStore.getState().getPane("pane-a");
    expect(state.runId).toBe("run-new");
    expect(state.events.map((item) => item.seq)).toEqual([9]);
  });

  it("keeps playback independent between panes and clears timers on close", async () => {
    await Promise.all([
      useReplayStore.getState().openRun(
        "pane-a",
        "session-1",
        "run-1",
        async () => page([event(1), event(2)]),
      ),
      useReplayStore.getState().openRun(
        "pane-b",
        "session-1",
        "run-1",
        async () => page([event(1), event(2)]),
      ),
    ]);
    useReplayStore.getState().play("pane-a");
    useReplayStore.getState().closeTab("pane-a");
    await vi.runAllTimersAsync();

    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(1);
    expect(useReplayStore.getState().getPane("pane-b").cursorSeq).toBe(1);
    expect(useReplayStore.getState().getPane("pane-a").playing).toBe(false);
  });

  it("does not restore pane-private controls from the shared run cache", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1), event(2)]),
    );
    useReplayStore.getState().setSpeed("pane-a", 2);
    useReplayStore.getState().setFilters("pane-a", new Set(["error"]));
    useReplayStore.getState().selectEvent("pane-a", "event-2");
    useReplayStore.getState().closeTab("pane-a");

    await useReplayStore.getState().openRun(
      "pane-b",
      "session-1",
      "run-1",
      async () => page([event(1), event(2)]),
    );

    expect(useReplayStore.getState().getPane("pane-a")).toMatchObject({
      cursorSeq: 2,
      selectedEventId: "event-2",
      speed: 2,
    });
    expect(useReplayStore.getState().getPane("pane-b")).toMatchObject({
      cursorSeq: 1,
      selectedEventId: null,
      speed: 1,
    });
    expect([...useReplayStore.getState().getPane("pane-b").filters]).toEqual(["all"]);
  });

  it("merges incremental ledger pages without moving the cursor", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(1), event(2)]),
    );
    useReplayStore.getState().appendPage("pane-a", page([event(3), event(4)]));

    expect(useReplayStore.getState().getPane("pane-a").events.map((item) => item.seq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(1);
  });

  it.each([150, 600])("loads all %i completed events before final statistics", async (count) => {
    const events = Array.from({ length: count }, (_, index) => event(index + 1, index));
    const loader = vi.fn(async (afterSeq: number) => pagedResponse(events, afterSeq, 100));

    await useReplayStore.getState().openRun("pane-a", "session-1", "run-1", loader);
    expect(useReplayStore.getState().getPane("pane-a").events).toHaveLength(100);

    await useReplayStore.getState().loadAllPages("pane-a");

    const state = useReplayStore.getState().getPane("pane-a");
    expect(state.events).toHaveLength(count);
    expect(state.hasMore).toBe(false);
    expect(loader).toHaveBeenCalledTimes(Math.ceil(count / 100));
  });

  it("stops completed-run pagination when the declared event count is reached", async () => {
    const events = Array.from({ length: 100 }, (_, index) => event(index + 1, index));
    const firstPage = pagedResponse(events, 0, 100);
    firstPage.hasMore = true;
    const loader = vi.fn(async () => firstPage);

    await useReplayStore.getState().openRun("pane-a", "session-1", "run-1", loader);
    await useReplayStore.getState().loadAllPages("pane-a");

    expect(loader).toHaveBeenCalledOnce();
    expect(useReplayStore.getState().getPane("pane-a").hasMore).toBe(false);
  });

  it.each([150, 600])("continues instant playback across pages for %i events", async (count) => {
    const events = Array.from({ length: count }, (_, index) => event(index + 1, index));
    const loader = vi.fn(async (afterSeq: number) => pagedResponse(events, afterSeq, 100));

    await useReplayStore.getState().openRun("pane-a", "session-1", "run-1", loader);
    useReplayStore.getState().setSpeed("pane-a", "instant");
    useReplayStore.getState().play("pane-a");
    await vi.runAllTimersAsync();

    const state = useReplayStore.getState().getPane("pane-a");
    expect(state.cursorSeq).toBe(count);
    expect(state.playing).toBe(false);
    expect(state.events).toHaveLength(count);
  });

  it("stops playback after one cross-page load failure and keeps retry available", async () => {
    const events = Array.from({ length: 150 }, (_, index) => event(index + 1, index));
    const never = new Promise<ReplayEventsResponse>(() => {});
    let pageAttempts = 0;
    const loader = vi.fn(async (afterSeq: number) => {
      if (afterSeq === 0) return pagedResponse(events, 0, 100);
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error("page failed");
      return await never;
    });

    await useReplayStore.getState().openRun("pane-a", "session-1", "run-1", loader);
    useReplayStore.getState().setSpeed("pane-a", "instant");
    useReplayStore.getState().play("pane-a");
    await vi.advanceTimersByTimeAsync(16);
    await Promise.resolve();
    await Promise.resolve();

    const state = useReplayStore.getState().getPane("pane-a");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(state.playing).toBe(false);
    expect(state.hasMore).toBe(true);
    expect(state.error).toBe("page failed");
  });

  it("renders ledger events in explicit 500-row batches", async () => {
    const events = Array.from({ length: 600 }, (_, index) => event(index + 1, index));
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page(events),
    );

    let state = useReplayStore.getState().getPane("pane-a");
    expect(state.events.slice(0, state.renderLimit)).toHaveLength(500);

    useReplayStore.getState().showMoreEvents("pane-a");
    state = useReplayStore.getState().getPane("pane-a");
    expect(state.events.slice(0, state.renderLimit)).toHaveLength(600);
  });

  it("expands the render batch when seeking beyond the current window", async () => {
    const events = Array.from({ length: 600 }, (_, index) => event(index + 1, index));
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page(events),
    );

    useReplayStore.getState().seek("pane-a", 600);

    expect(useReplayStore.getState().getPane("pane-a").renderLimit).toBe(1_000);
  });

  it("steps by sparse sequence ordering and clamps at real event boundaries", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page([event(2), event(10), event(30)]),
    );

    useReplayStore.getState().seek("pane-a", 0);
    useReplayStore.getState().step("pane-a", 1);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(2);

    useReplayStore.getState().seek("pane-a", 20);
    useReplayStore.getState().step("pane-a", -1);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(10);

    useReplayStore.getState().seek("pane-a", 99);
    useReplayStore.getState().step("pane-a", -1);
    expect(useReplayStore.getState().getPane("pane-a").cursorSeq).toBe(30);
  });

  it("keeps a five-entry bounded payload LRU per pane without mutating events", async () => {
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-1",
      async () => page(Array.from({ length: 7 }, (_, index) => event(index + 1))),
    );
    const originalEvents = useReplayStore.getState().getPane("pane-a").events;
    for (let index = 1; index <= 6; index += 1) {
      useReplayStore.getState().cacheEventPayload("pane-a", `event-${index}`, {
        output: index === 6 ? "x".repeat(32 * 1024 * 1024) : `payload-${index}`,
      });
    }

    const state = useReplayStore.getState().getPane("pane-a");
    expect(state.events).toBe(originalEvents);
    expect(Object.keys(state.payloadCache)).toEqual([
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
    ]);
    expect(state.payloadCache["event-6"]?.truncated).toBe(true);
    expect(new TextEncoder().encode(state.payloadCache["event-6"]?.displayText).byteLength)
      .toBeLessThanOrEqual(256 * 1024);

    useReplayStore.getState().cacheEventPayload("pane-b", "event-other", { output: "other" });
    expect(useReplayStore.getState().getPane("pane-a").payloadCache["event-other"]).toBeUndefined();
  });

  it("does not append an old pagination request after switching runs", async () => {
    let resolveOldPage: ((value: ReplayEventsResponse) => void) | undefined;
    const oldEvents = Array.from({ length: 150 }, (_, index) => event(index + 1, index));
    const oldLoader = vi.fn(async (afterSeq: number) => {
      if (afterSeq === 0) return pagedResponse(oldEvents, 0, 100, "run-old");
      return await new Promise<ReplayEventsResponse>((resolve) => {
        resolveOldPage = resolve;
      });
    });

    await useReplayStore.getState().openRun("pane-a", "session-1", "run-old", oldLoader);
    const loadingOldPage = useReplayStore.getState().loadNextPage("pane-a");
    await useReplayStore.getState().openRun(
      "pane-a",
      "session-1",
      "run-new",
      async () => page([event(900)], "run-new"),
    );
    resolveOldPage?.(pagedResponse(oldEvents, 100, 100, "run-old"));
    await loadingOldPage;

    const state = useReplayStore.getState().getPane("pane-a");
    expect(state.runId).toBe("run-new");
    expect(state.events.map((item) => item.seq)).toEqual([900]);
  });
});
