import type { DeepResearchEvent } from "@agenticx/core-api";

/**
 * Append a deep-research event without letting full-text progress snapshots
 * crowd durable phase, lane, and artifact events out of the message history.
 */
export function appendDeepResearchEvent(
  current: DeepResearchEvent[],
  event: DeepResearchEvent,
  limit: number,
): DeepResearchEvent[] {
  if (event.type === "reasoning") {
    const existing = current.findIndex(
      (candidate) => candidate.type === "reasoning" && candidate.id === event.id,
    );
    if (existing >= 0) {
      const next = current.slice();
      next[existing] = event;
      return next.slice(-limit);
    }
  }
  return [...current, event].slice(-limit);
}
