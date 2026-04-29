/**
 * Streaming-state policies shared by ChatPane:
 *
 * 1. canStopCurrentRun(...)  — should the input-area "stop" button be visible?
 * 2. shouldInterruptOnResend(...) — should a Send during streaming abort the
 *    current run and start a new round (Cursor/ChatGPT-style "barge-in")
 *    instead of enqueueing a follow-up?
 *
 * Both are unified across single-avatar and group-chat panes: group chats
 * historically excluded themselves from the stream-state UI, which silently
 * disabled stopping and forced follow-ups into a queue. These helpers are
 * the single source of truth.
 */

export type StreamingStopInput = {
  /** True iff the desktop store's `streaming` flag is on. */
  streaming: boolean;
  /** Session id that the streaming run is bound to. */
  streamingSessionId: string;
  /** Currently visible pane's session id. */
  currentSessionId: string;
};

export function canStopCurrentRun(opts: StreamingStopInput): boolean {
  if (!opts.streaming) return false;
  const sid = (opts.streamingSessionId || "").trim();
  if (!sid) return false;
  return sid === (opts.currentSessionId || "").trim();
}

export type StreamingResendInput = {
  /** True if the target session has an active SSE run in flight. */
  isStreamRunActive: boolean;
};

export function shouldInterruptOnResend(opts: StreamingResendInput): boolean {
  return opts.isStreamRunActive;
}
