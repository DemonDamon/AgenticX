import type { ChatMessage } from "@agenticx/core-api";

/** Running runs restored into the session that still need a live reconnect. */
export function runningDeepResearchRunIds(
  messages: readonly ChatMessage[],
  sessionId: string,
): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.session_id !== sessionId || message.role !== "assistant") continue;
    const runId = message.deep_research?.runId?.trim();
    if (!runId || runId === "pending") continue;
    if (message.deep_research?.status !== "running") continue;
    if (!ids.includes(runId)) ids.push(runId);
  }
  return ids;
}

/**
 * Pick runs to reconnect once per session view. Runs seen while the original
 * stream is live are marked handled so its normal end never triggers a replay.
 */
export function takeDeepResearchRunsToRecover(input: {
  messages: readonly ChatMessage[];
  sessionId: string;
  streaming: boolean;
  handled: Set<string>;
}): string[] {
  const running = runningDeepResearchRunIds(input.messages, input.sessionId);
  const picked: string[] = [];
  for (const runId of running) {
    if (input.handled.has(runId)) continue;
    input.handled.add(runId);
    if (!input.streaming) picked.push(runId);
  }
  return picked;
}
