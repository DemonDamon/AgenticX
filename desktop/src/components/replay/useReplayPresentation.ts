import { useReplayStore } from "./replay-store";
import type { ReplayEvent } from "./replay-types";

const IDLE_EVENTS: ReplayEvent[] = [];

export function useReplayPresentation(paneId: string): {
  presenting: boolean;
  cursorSeq: number;
  events: ReplayEvent[];
  sessionId: string | null;
} {
  const presenting = useReplayStore((state) => state.byPane[paneId]?.presenting === true);
  const cursorSeq = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.cursorSeq : 0
  ));
  const events = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.events : IDLE_EVENTS
  ));
  const sessionId = useReplayStore((state) => (
    state.byPane[paneId]?.presenting ? state.byPane[paneId]!.sessionId : null
  ));
  return { presenting, cursorSeq, events, sessionId };
}
