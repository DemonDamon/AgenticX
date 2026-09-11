import { useEffect, useMemo, useState } from "react";
import {
  assistantTextStreamBeatType,
  presentationDwellMs,
} from "./replay-presentation";
import { useReplayStore } from "./replay-store";
import type { ReplayEvent } from "./replay-types";

const IDLE_EVENTS: ReplayEvent[] = [];

export function useReplayPresentation(paneId: string): {
  presenting: boolean;
  cursorSeq: number;
  events: ReplayEvent[];
  sessionId: string | null;
  streamElapsedMs: number;
  streamDurationMs: number;
  streamSnapFull: boolean;
} {
  const presenting = useReplayStore((state) => state.byPane[paneId]?.presenting === true);
  const playing = useReplayStore((state) => state.byPane[paneId]?.playing === true);
  const cursorSeq = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.cursorSeq : 0
  ));
  const events = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.events : IDLE_EVENTS
  ));
  const sessionId = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.sessionId : null
  ));
  const speed = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.speed : 1
  ));

  const streamBeatType = useMemo(() => (
    presenting ? assistantTextStreamBeatType(events, cursorSeq) : ""
  ), [presenting, events, cursorSeq]);
  const streamDurationMs = streamBeatType
    ? presentationDwellMs(streamBeatType, speed)
    : 0;
  const [streamElapsedMs, setStreamElapsedMs] = useState(0);

  useEffect(() => {
    if (!presenting || !streamBeatType) {
      setStreamElapsedMs(0);
      return;
    }
    if (!playing) return;
    const duration = presentationDwellMs(streamBeatType, speed);
    const startedAt = performance.now();
    let lastBucket = -1;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(duration, now - startedAt);
      const bucket = Math.floor(elapsed / 32);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        setStreamElapsedMs(elapsed);
      }
      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
      } else {
        setStreamElapsedMs(duration);
      }
    };
    setStreamElapsedMs(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [presenting, playing, streamBeatType, cursorSeq, speed]);

  return {
    presenting,
    cursorSeq,
    events,
    sessionId,
    streamElapsedMs,
    streamDurationMs,
    streamSnapFull: presenting && Boolean(streamBeatType) && !playing && streamElapsedMs <= 0,
  };
}
