/**
 * Streaming-state policies shared by ChatPane / ChatView.
 */

export type SessionExecutionState = "idle" | "running" | "interrupted";

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

export function shouldShowStopForExecutionState(
  state: SessionExecutionState | string | undefined
): boolean {
  return (state || "").trim() === "running";
}

export type ShowStopButtonInput = StreamingStopInput & {
  executionState?: SessionExecutionState | string;
  runGuardSessionId?: string;
  currentSessionId: string;
  hasDelegation?: boolean;
  isGroupPane?: boolean;
};

/** Single source of truth for composer stop button visibility. */
export function shouldShowStopButton(opts: ShowStopButtonInput): boolean {
  if (canStopCurrentRun(opts)) return true;
  const sid = (opts.currentSessionId || "").trim();
  if (
    opts.runGuardSessionId &&
    opts.runGuardSessionId === sid &&
    shouldShowStopForExecutionState(opts.executionState)
  ) {
    return true;
  }
  if (shouldShowStopForExecutionState(opts.executionState) && sid) {
    return true;
  }
  if (opts.hasDelegation && !opts.isGroupPane) return true;
  return false;
}

export type StreamingResendInput = {
  /** True if the target session has an active SSE run in flight. */
  isStreamRunActive: boolean;
};

export function shouldInterruptOnResend(opts: StreamingResendInput): boolean {
  return opts.isStreamRunActive;
}
