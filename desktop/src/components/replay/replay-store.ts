import { create } from "zustand";
import {
  buildReplayPayloadDisplay,
  type ReplayPayloadDisplay,
} from "./replay-payload";
import type {
  ReplayEvent,
  ReplayEventsResponse,
  ReplayFilter,
  ReplayRun,
  ReplaySpeed,
} from "./replay-types";

export type ReplayPlaybackState = {
  sessionId: string | null;
  runId: string | null;
  run: ReplayRun | null;
  events: ReplayEvent[];
  renderLimit: number;
  cursorSeq: number;
  selectedEventId: string | null;
  playing: boolean;
  speed: ReplaySpeed;
  filters: Set<ReplayFilter>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  nextSeq: number;
  error: string | null;
  parseWarnings: string[];
  payloadCache: Record<string, ReplayPayloadDisplay>;
  payloadOrder: string[];
};

type PageLoader = (afterSeq: number, signal: AbortSignal) => Promise<ReplayEventsResponse>;

type ReplayStore = {
  byPane: Record<string, ReplayPlaybackState>;
  getPane: (paneId: string) => ReplayPlaybackState;
  openRun: (
    paneId: string,
    sessionId: string,
    runId: string,
    loader: PageLoader,
  ) => Promise<void>;
  appendPage: (paneId: string, page: ReplayEventsResponse) => void;
  loadNextPage: (paneId: string) => Promise<void>;
  loadAllPages: (paneId: string) => Promise<void>;
  setLoadingMore: (paneId: string, loading: boolean) => void;
  setError: (paneId: string, error: string | null) => void;
  setSpeed: (paneId: string, speed: ReplaySpeed) => void;
  setFilters: (paneId: string, filters: Set<ReplayFilter>) => void;
  play: (paneId: string) => void;
  pause: (paneId: string) => void;
  seek: (paneId: string, seq: number) => void;
  step: (paneId: string, direction: -1 | 1) => void;
  selectEvent: (paneId: string, eventId: string | null) => void;
  cacheEventPayload: (
    paneId: string,
    eventId: string,
    payload: Record<string, unknown> | undefined,
  ) => void;
  showMoreEvents: (paneId: string) => void;
  resetPane: (paneId: string) => void;
  closeTab: (paneId: string) => void;
  resetAll: () => void;
};

const EMPTY_REPLAY_STATE: ReplayPlaybackState = {
  sessionId: null,
  runId: null,
  run: null,
  events: [],
  renderLimit: 500,
  cursorSeq: 0,
  selectedEventId: null,
  playing: false,
  speed: 1,
  filters: new Set<ReplayFilter>(["all"]),
  loading: false,
  loadingMore: false,
  hasMore: false,
  nextSeq: 0,
  error: null,
  parseWarnings: [],
  payloadCache: {},
  payloadOrder: [],
};

type TimerHandle = ReturnType<typeof setTimeout>;
type PlaybackHandle =
  | { kind: "timer"; id: TimerHandle }
  | { kind: "frame"; id: number };
const playbackTimers = new Map<string, PlaybackHandle>();
const fetchControllers = new Map<string, AbortController>();
const requestVersions = new Map<string, number>();
type ReplayDataCacheEntry = Pick<
  ReplayPlaybackState,
  "run" | "events" | "hasMore" | "nextSeq" | "parseWarnings"
>;
type EventMergeIndex = {
  runId: string;
  byId: Map<string, number>;
  bySeq: Map<number, string>;
  lastSeq: number;
};
const replayCache = new Map<string, ReplayDataCacheEntry>();
const pageLoaders = new Map<string, PageLoader>();
const pageLoadPromises = new Map<string, Promise<void>>();
const eventMergeIndexes = new Map<string, EventMergeIndex>();
const RENDER_BATCH_SIZE = 500;
const PAYLOAD_CACHE_SIZE = 5;

function renderLimitForCursor(
  events: ReplayEvent[],
  cursorSeq: number,
  currentLimit: number,
): number {
  const cursorIndex = events.findIndex((event) => event.seq >= cursorSeq);
  if (cursorIndex < 0 || cursorIndex < currentLimit) return currentLimit;
  return Math.ceil((cursorIndex + 1) / RENDER_BATCH_SIZE) * RENDER_BATCH_SIZE;
}

function freshState(): ReplayPlaybackState {
  return {
    ...EMPTY_REPLAY_STATE,
    filters: new Set(["all"]),
    payloadCache: {},
    payloadOrder: [],
  };
}

function cacheKey(sessionId: string, runId: string): string {
  return `${sessionId}/${runId}`;
}

function cacheState(state: ReplayPlaybackState): void {
  if (!state.sessionId || !state.runId) return;
  const key = cacheKey(state.sessionId, state.runId);
  replayCache.delete(key);
  replayCache.set(key, {
    run: state.run,
    events: state.events,
    hasMore: state.hasMore,
    nextSeq: state.nextSeq,
    parseWarnings: state.parseWarnings,
  });
  while (replayCache.size > 5) {
    const oldest = replayCache.keys().next().value as string | undefined;
    if (!oldest) break;
    replayCache.delete(oldest);
  }
}

function clearPlaybackTimer(paneId: string): void {
  const handle = playbackTimers.get(paneId);
  if (handle?.kind === "timer") clearTimeout(handle.id);
  if (handle?.kind === "frame" && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle.id);
  }
  playbackTimers.delete(paneId);
}

function abortFetch(paneId: string): void {
  fetchControllers.get(paneId)?.abort();
  fetchControllers.delete(paneId);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function eventIndexForPane(
  paneId: string,
  runId: string,
  current: ReplayEvent[],
): EventMergeIndex {
  const existing = eventMergeIndexes.get(paneId);
  if (existing?.runId === runId && existing.byId.size === current.length) return existing;
  const next: EventMergeIndex = {
    runId,
    byId: new Map(),
    bySeq: new Map(),
    lastSeq: 0,
  };
  current.forEach((event, index) => {
    next.byId.set(event.eventId, index);
    next.bySeq.set(event.seq, event.eventId);
    next.lastSeq = event.seq;
  });
  eventMergeIndexes.set(paneId, next);
  return next;
}

function mergeEvents(
  paneId: string,
  runId: string,
  current: ReplayEvent[],
  incoming: ReplayEvent[],
): ReplayEvent[] {
  const index = eventIndexForPane(paneId, runId, current);
  let next = current;
  for (const event of incoming) {
    if (
      event.seq <= index.lastSeq
      || index.byId.has(event.eventId)
      || index.bySeq.has(event.seq)
    ) continue;
    if (next === current) next = current.slice();
    index.byId.set(event.eventId, next.length);
    index.bySeq.set(event.seq, event.eventId);
    index.lastSeq = event.seq;
    next.push(event);
  }
  return next;
}

function scheduleNext(paneId: string): void {
  clearPlaybackTimer(paneId);
  const state = useReplayStore.getState().getPane(paneId);
  if (!state.playing || state.events.length === 0) return;
  const nextIndex = state.events.findIndex((event) => event.seq > state.cursorSeq);
  if (nextIndex < 0) {
    if (state.hasMore) {
      void useReplayStore.getState().loadNextPage(paneId).then(() => scheduleNext(paneId));
    } else {
      useReplayStore.getState().pause(paneId);
    }
    return;
  }
  if (state.speed === "instant") {
    const advanceFrame = () => {
      const latest = useReplayStore.getState().getPane(paneId);
      if (!latest.playing) return;
      const start = latest.events.findIndex((event) => event.seq > latest.cursorSeq);
      if (start < 0) {
        if (latest.hasMore) {
          void useReplayStore.getState().loadNextPage(paneId).then(() => scheduleNext(paneId));
        } else {
          useReplayStore.getState().pause(paneId);
        }
        return;
      }
      const target = latest.events[Math.min(latest.events.length - 1, start + 99)];
      if (!target) return;
      useReplayStore.setState((store) => ({
        byPane: {
          ...store.byPane,
          [paneId]: {
            ...latest,
            cursorSeq: target.seq,
            renderLimit: renderLimitForCursor(latest.events, target.seq, latest.renderLimit),
            playing: target === latest.events.at(-1) && !latest.hasMore ? false : latest.playing,
          },
        },
      }));
      if (target !== latest.events.at(-1)) {
        scheduleNext(paneId);
      } else if (latest.hasMore) {
        void useReplayStore.getState().loadNextPage(paneId).then(() => scheduleNext(paneId));
      } else {
        clearPlaybackTimer(paneId);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      playbackTimers.set(paneId, { kind: "frame", id: requestAnimationFrame(advanceFrame) });
    } else {
      playbackTimers.set(paneId, { kind: "timer", id: setTimeout(advanceFrame, 16) });
    }
    return;
  }
  const current = [...state.events].reverse().find((event) => event.seq <= state.cursorSeq);
  const next = state.events[nextIndex];
  if (!next) return;
  const delta = current ? Math.max(0, next.ts - current.ts) : 0;
  const delay = Math.min(1_500, Math.max(80, delta / state.speed));
  playbackTimers.set(paneId, { kind: "timer", id: setTimeout(() => {
    const latest = useReplayStore.getState().getPane(paneId);
    if (!latest.playing) return;
    const candidate = latest.events.find((event) => event.seq > latest.cursorSeq);
    if (!candidate) {
      if (latest.hasMore) {
        void useReplayStore.getState().loadNextPage(paneId).then(() => scheduleNext(paneId));
      } else {
        useReplayStore.getState().pause(paneId);
      }
      return;
    }
    const atEnd = candidate === latest.events.at(-1);
    useReplayStore.setState((store) => ({
      byPane: {
        ...store.byPane,
        [paneId]: {
          ...latest,
          cursorSeq: candidate.seq,
          renderLimit: renderLimitForCursor(latest.events, candidate.seq, latest.renderLimit),
          playing: !atEnd || latest.hasMore,
        },
      },
    }));
    if (!atEnd) {
      scheduleNext(paneId);
    } else if (latest.hasMore) {
      void useReplayStore.getState().loadNextPage(paneId).then(() => scheduleNext(paneId));
    } else {
      clearPlaybackTimer(paneId);
    }
  }, delay) });
}

export const useReplayStore = create<ReplayStore>((set, get) => ({
  byPane: {},
  getPane: (paneId) => get().byPane[paneId] ?? EMPTY_REPLAY_STATE,
  openRun: async (paneId, sessionId, runId, loader) => {
    clearPlaybackTimer(paneId);
    abortFetch(paneId);
    const version = (requestVersions.get(paneId) ?? 0) + 1;
    requestVersions.set(paneId, version);
    pageLoaders.set(paneId, loader);
    const cached = replayCache.get(cacheKey(sessionId, runId));
    if (cached) {
      const events = cached.events;
      eventIndexForPane(paneId, runId, events);
      set((store) => ({
        byPane: {
          ...store.byPane,
          [paneId]: {
            ...freshState(),
            sessionId,
            runId,
            ...cached,
            cursorSeq: events[0]?.seq ?? 0,
          },
        },
      }));
      return;
    }
    const controller = new AbortController();
    fetchControllers.set(paneId, controller);
    set((store) => ({
      byPane: {
        ...store.byPane,
        [paneId]: {
          ...freshState(),
          sessionId,
          runId,
          loading: true,
        },
      },
    }));
    try {
      const page = await loader(0, controller.signal);
      if (requestVersions.get(paneId) !== version || controller.signal.aborted) return;
      const events = mergeEvents(paneId, runId, [], page.events);
      const next: ReplayPlaybackState = {
        ...freshState(),
        sessionId,
        runId,
        run: page.run,
        events,
        cursorSeq: events[0]?.seq ?? 0,
        loading: false,
        hasMore: page.hasMore && events.length < page.run.eventCount,
        nextSeq: page.nextSeq,
        parseWarnings: page.parseWarnings,
      };
      set((store) => ({ byPane: { ...store.byPane, [paneId]: next } }));
      cacheState(next);
    } catch (error) {
      if (requestVersions.get(paneId) !== version || isAbortError(error)) return;
      set((store) => ({
        byPane: {
          ...store.byPane,
          [paneId]: {
            ...(store.byPane[paneId] ?? freshState()),
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }));
    } finally {
      if (fetchControllers.get(paneId) === controller) fetchControllers.delete(paneId);
    }
  },
  appendPage: (paneId, page) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    if (current.runId !== page.run.runId) return store;
    const events = mergeEvents(paneId, page.run.runId, current.events, page.events);
    const next = {
      ...current,
      run: page.run,
      events,
      hasMore: page.hasMore && events.length < page.run.eventCount,
      nextSeq: Math.max(current.nextSeq, page.nextSeq),
      loadingMore: false,
      error: null,
      parseWarnings: [...current.parseWarnings, ...page.parseWarnings],
    };
    cacheState(next);
    return { byPane: { ...store.byPane, [paneId]: next } };
  }),
  loadNextPage: async (paneId) => {
    const existing = pageLoadPromises.get(paneId);
    if (existing) return await existing;
    const current = get().getPane(paneId);
    const loader = pageLoaders.get(paneId);
    if (!loader || !current.hasMore || current.loading) return;
    const version = requestVersions.get(paneId);
    const expectedSessionId = current.sessionId;
    const expectedRunId = current.runId;
    const controller = new AbortController();
    abortFetch(paneId);
    fetchControllers.set(paneId, controller);
    get().setLoadingMore(paneId, true);
    get().setError(paneId, null);
    const request = (async () => {
      try {
        const page = await loader(current.nextSeq, controller.signal);
        const latest = get().getPane(paneId);
        if (
          controller.signal.aborted
          || requestVersions.get(paneId) !== version
          || latest.sessionId !== expectedSessionId
          || latest.runId !== expectedRunId
        ) return;
        get().appendPage(paneId, page);
      } catch (error) {
        if (!isAbortError(error)) {
          get().pause(paneId);
          get().setLoadingMore(paneId, false);
          get().setError(paneId, error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (fetchControllers.get(paneId) === controller) fetchControllers.delete(paneId);
      }
    })();
    pageLoadPromises.set(paneId, request);
    try {
      await request;
    } finally {
      if (pageLoadPromises.get(paneId) === request) pageLoadPromises.delete(paneId);
    }
  },
  loadAllPages: async (paneId) => {
    while (true) {
      const before = get().getPane(paneId);
      if (!before.hasMore) return;
      await get().loadNextPage(paneId);
      const after = get().getPane(paneId);
      if (
        after.runId !== before.runId
        || after.sessionId !== before.sessionId
        || (after.nextSeq === before.nextSeq && after.events.length === before.events.length)
      ) return;
    }
  },
  setLoadingMore: (paneId, loadingMore) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    return { byPane: { ...store.byPane, [paneId]: { ...current, loadingMore } } };
  }),
  setError: (paneId, error) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    return { byPane: { ...store.byPane, [paneId]: { ...current, error } } };
  }),
  setSpeed: (paneId, speed) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    const next = { ...current, speed };
    if (current.playing) queueMicrotask(() => scheduleNext(paneId));
    return { byPane: { ...store.byPane, [paneId]: next } };
  }),
  setFilters: (paneId, filters) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    return {
      byPane: {
        ...store.byPane,
        [paneId]: { ...current, filters: new Set(filters) },
      },
    };
  }),
  play: (paneId) => {
    const current = get().getPane(paneId);
    if (current.events.length < 2) return;
    const lastSeq = current.events.at(-1)?.seq ?? 0;
    const cursorSeq = current.cursorSeq >= lastSeq
      ? current.events[0]?.seq ?? 0
      : current.cursorSeq;
    set((store) => ({
      byPane: {
        ...store.byPane,
        [paneId]: { ...current, cursorSeq, playing: true },
      },
    }));
    scheduleNext(paneId);
  },
  pause: (paneId) => {
    clearPlaybackTimer(paneId);
    set((store) => {
      const current = store.byPane[paneId] ?? freshState();
      return { byPane: { ...store.byPane, [paneId]: { ...current, playing: false } } };
    });
  },
  seek: (paneId, seq) => {
    clearPlaybackTimer(paneId);
    set((store) => {
      const current = store.byPane[paneId] ?? freshState();
      const selected = current.events.find((event) => event.eventId === current.selectedEventId);
      return {
        byPane: {
          ...store.byPane,
          [paneId]: {
            ...current,
            cursorSeq: seq,
            renderLimit: renderLimitForCursor(current.events, seq, current.renderLimit),
            selectedEventId: selected && selected.seq > seq ? null : current.selectedEventId,
            playing: false,
          },
        },
      };
    });
  },
  step: (paneId, direction) => {
    const current = get().getPane(paneId);
    if (current.events.length === 0) return;
    const target = direction === 1
      ? current.events.find((event) => event.seq > current.cursorSeq)
      : (() => {
          for (let index = current.events.length - 1; index >= 0; index -= 1) {
            const candidate = current.events[index];
            if (candidate && candidate.seq < current.cursorSeq) return candidate;
          }
          return undefined;
        })();
    if (target) get().seek(paneId, target.seq);
  },
  selectEvent: (paneId, eventId) => {
    clearPlaybackTimer(paneId);
    set((store) => {
      const current = store.byPane[paneId] ?? freshState();
      return {
        byPane: {
          ...store.byPane,
          [paneId]: {
            ...current,
            selectedEventId: eventId,
            playing: false,
          },
        },
      };
    });
  },
  cacheEventPayload: (paneId, eventId, payload) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    const payloadOrder = current.payloadOrder.filter((id) => id !== eventId);
    payloadOrder.push(eventId);
    const payloadCache = {
      ...current.payloadCache,
      [eventId]: buildReplayPayloadDisplay(payload),
    };
    while (payloadOrder.length > PAYLOAD_CACHE_SIZE) {
      const oldest = payloadOrder.shift();
      if (oldest) delete payloadCache[oldest];
    }
    return {
      byPane: {
        ...store.byPane,
        [paneId]: { ...current, payloadCache, payloadOrder },
      },
    };
  }),
  showMoreEvents: (paneId) => set((store) => {
    const current = store.byPane[paneId] ?? freshState();
    return {
      byPane: {
        ...store.byPane,
        [paneId]: { ...current, renderLimit: current.renderLimit + RENDER_BATCH_SIZE },
      },
    };
  }),
  resetPane: (paneId) => {
    clearPlaybackTimer(paneId);
    abortFetch(paneId);
    requestVersions.set(paneId, (requestVersions.get(paneId) ?? 0) + 1);
    pageLoaders.delete(paneId);
    pageLoadPromises.delete(paneId);
    eventMergeIndexes.delete(paneId);
    set((store) => ({
      byPane: {
        ...store.byPane,
        [paneId]: freshState(),
      },
    }));
  },
  closeTab: (paneId) => {
    clearPlaybackTimer(paneId);
    abortFetch(paneId);
    pageLoaders.delete(paneId);
    pageLoadPromises.delete(paneId);
    eventMergeIndexes.delete(paneId);
    set((store) => {
      const current = store.byPane[paneId];
      if (!current) return store;
      const next = { ...current, playing: false, loading: false, loadingMore: false };
      cacheState(next);
      return { byPane: { ...store.byPane, [paneId]: next } };
    });
  },
  resetAll: () => {
    for (const paneId of playbackTimers.keys()) clearPlaybackTimer(paneId);
    for (const paneId of fetchControllers.keys()) abortFetch(paneId);
    requestVersions.clear();
    replayCache.clear();
    pageLoaders.clear();
    pageLoadPromises.clear();
    eventMergeIndexes.clear();
    set({ byPane: {} });
  },
}));
