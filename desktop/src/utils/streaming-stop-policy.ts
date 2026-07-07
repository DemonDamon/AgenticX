/**
 * Streaming-state policies shared by ChatPane / ChatView.
 */

import { parseTodoMessage } from "../components/TodoUpdateCard";
import { messageLooksLikeAssistantFinal } from "./task-stall-policy";
import type { Message } from "../store";

export type SessionExecutionState = "idle" | "running" | "interrupted" | "failed";

export type StallPhase = "none" | "stall" | "exhausted";

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
  /** When true, show stop + typing indicator for unattended/stall waits without local SSE. */
  sessionWorkInProgress?: boolean;
};

export type SessionWorkInProgressInput = {
  isStreamingCurrentSession: boolean;
  executionState?: SessionExecutionState | string;
  stallState?: StallPhase;
  sessionUnattended?: boolean;
  unattendedGlobalEnabled?: boolean;
  userStopped?: boolean;
  messages?: Message[];
  isGroupPane?: boolean;
};

function latestTodoFromMessages(messages: Message[] | undefined) {
  if (!messages?.length) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "tool" && (m.toolName ?? "").trim() === "todo_write") {
      return parseTodoMessage(typeof m.content === "string" ? m.content : "");
    }
  }
  return null;
}

/** True when todos exist and at least one item is not completed. */
export function hasOpenTodosFromMessages(messages: Message[] | undefined): boolean {
  const parsed = latestTodoFromMessages(messages);
  if (!parsed || parsed.total <= 0) return false;
  if (parsed.completed >= parsed.total) return false;
  return parsed.items.some((item) => item.status !== "completed");
}

/** True when todos exist and every item is completed. */
export function todosAllCompletedFromMessages(messages: Message[] | undefined): boolean {
  const parsed = latestTodoFromMessages(messages);
  if (!parsed || parsed.total <= 0) return false;
  return parsed.completed >= parsed.total;
}

/**
 * Show bouncing dots + stop while SSE is local, backend is running, stalled,
 * or unattended mode is waiting to continue unfinished work.
 */
export function shouldShowSessionWorkInProgress(opts: SessionWorkInProgressInput): boolean {
  if (opts.isGroupPane) return false;
  if (opts.isStreamingCurrentSession) return true;
  const execState = (opts.executionState || "idle").trim();
  if (execState === "failed") return false;
  if (opts.userStopped) return false;
  if (shouldShowStopForExecutionState(execState)) return true;
  // "stall" = actively hung: keep spinner. "exhausted" = gave up: taskLiveness handles it
  // via the "stalled" branch so sessionWorkInProgress no longer needs to return true.
  if (opts.stallState === "stall") return true;

  if (!opts.sessionUnattended || !opts.unattendedGlobalEnabled) return false;

  const messages = opts.messages ?? [];
  const hasUserMessage = messages.some((m) => m.role === "user");
  if (!hasUserMessage) return false;
  if (todosAllCompletedFromMessages(messages)) return false;

  const lastMsg = messages[messages.length - 1];
  // Bug-fix: Only bridge between turns when the backend confirms the session is
  // actively running. When execState is "idle", the backend has already finished —
  // trust it and stop the spinner. Stall detection will handle genuinely incomplete
  // sessions. Previously, "unattended + open todos + idle backend" caused the main
  // pane to spin forever while the history panel (which reads execution_state
  // directly) correctly showed no spinner — a visible state desync.
  if (hasOpenTodosFromMessages(messages) && execState !== "idle") return true;
  if (execState === "interrupted") return true;
  return !messageLooksLikeAssistantFinal(lastMsg);
}

/** Single source of truth for composer stop button visibility. */
export function shouldShowStopButton(opts: ShowStopButtonInput): boolean {
  if (opts.sessionWorkInProgress) return true;
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
  /** User explicitly bypasses the queue (double-Enter or send-now). */
  forceSend?: boolean;
  /** Auto-send dequeued after prior turn finished; must not re-enqueue. */
  queueDrain?: boolean;
};

export type StreamRunActiveInput = {
  sessionId: string;
  streamStateActive?: boolean;
  sendInFlightForSession?: boolean;
  executionState?: SessionExecutionState | string;
  currentSessionId?: string;
};

export type ResolveQueueSessionKeyInput = {
  currentSessionId: string;
  inFlightSessionId?: string;
  /** When user explicitly started a fresh lazy session, never borrow in-flight id. */
  awaitingFreshSession?: boolean;
};

/**
 * Session key used for queue / stream-active checks.
 * Empty current session + background in-flight must NOT merge when awaiting fresh.
 */
export function resolveQueueSessionKey(opts: ResolveQueueSessionKeyInput): string {
  const sid = (opts.currentSessionId || "").trim();
  if (opts.awaitingFreshSession) return sid;
  const inFlight = (opts.inFlightSessionId || "").trim();
  return sid || inFlight;
}

/** Whether a follow-up should queue instead of starting a concurrent send. */
export function isStreamRunActiveForQueue(opts: StreamRunActiveInput): boolean {
  const sid = (opts.sessionId || "").trim();
  if (!sid) return false;
  if (opts.streamStateActive) return true;
  if (opts.sendInFlightForSession) return true;
  if (
    sid === (opts.currentSessionId || "").trim() &&
    shouldShowStopForExecutionState(opts.executionState)
  ) {
    return true;
  }
  return false;
}

/** Default: enqueue follow-ups while a stream run is active. */
export function shouldEnqueueOnResend(opts: StreamingResendInput): boolean {
  if (opts.forceSend || opts.queueDrain) return false;
  return opts.isStreamRunActive;
}

export function shouldInterruptOnResend(opts: StreamingResendInput): boolean {
  if (!opts.isStreamRunActive || opts.queueDrain) return false;
  return !!opts.forceSend;
}

/** Window for double-Enter "send now" while a run is active. */
export const MESSAGE_QUEUE_DOUBLE_ENTER_MS = 400;

export function isDoubleEnterWithinWindow(
  lastEnterAtMs: number,
  nowMs: number = Date.now()
): boolean {
  if (lastEnterAtMs <= 0) return false;
  return nowMs - lastEnterAtMs <= MESSAGE_QUEUE_DOUBLE_ENTER_MS;
}
