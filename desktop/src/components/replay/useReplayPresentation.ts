import { useEffect, useMemo, useState } from "react";
import {
  assistantTextStreamBeatType,
  bindMessagesToRun,
  presentationAssistantStreamMs,
  revealedAssistantCharCount,
  type PresentationMessage,
} from "./replay-presentation";
import { useReplayStore } from "./replay-store";
import type { ReplayEvent } from "./replay-types";

const IDLE_EVENTS: ReplayEvent[] = [];
const IDLE_MESSAGES: PresentationMessage[] = [];

export function useReplayPresentation(
  paneId: string,
  messages: readonly PresentationMessage[] = IDLE_MESSAGES,
): {
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
  const streamCharCount = useMemo(() => {
    if (!presenting || !streamBeatType) return 0;
    const binding = bindMessagesToRun(messages, events);
    const message = messages.find((item) => (
      item.role === "assistant"
      && !item.systemNotice
      && binding.completeSeq.get(item.id) === cursorSeq
    ));
    return message ? Array.from(message.content ?? "").length : 0;
  }, [presenting, streamBeatType, messages, events, cursorSeq]);
  const streamDurationMs = streamBeatType
    ? presentationAssistantStreamMs(streamCharCount, speed)
    : 0;
  const [streamElapsedMs, setStreamElapsedMs] = useState(0);

  useEffect(() => {
    if (!presenting || !streamBeatType) {
      setStreamElapsedMs(0);
      return;
    }
    if (!playing) return;
    const duration = presentationAssistantStreamMs(streamCharCount, speed);
    const startedAt = performance.now();
    let lastCount = -1;
    let raf = 0;
    let finished = false;
    const tick = (now: number) => {
      const elapsed = Math.min(duration, now - startedAt);
      const count = revealedAssistantCharCount(streamCharCount, elapsed, duration);
      if (count !== lastCount) {
        lastCount = count;
        setStreamElapsedMs(elapsed);
      }
      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
        return;
      }
      setStreamElapsedMs(duration);
      if (finished) return;
      finished = true;
      useReplayStore.getState().finishPresentationStream(paneId);
    };
    setStreamElapsedMs(0);
    raf = requestAnimationFrame(tick);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
    };
  }, [presenting, playing, streamBeatType, cursorSeq, speed, streamCharCount, paneId]);

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
