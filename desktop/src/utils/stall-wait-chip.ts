/**
 * Stall-wait chip (Cursor-style patient waiting indicator) state helpers.
 *
 * The backend emits tool_progress events with phase="stall_patient_wait" while
 * it patiently retries a timed-out LLM round; the chip renders a local
 * countdown from these fields and disappears on recovery/final/error.
 */

export type StallWaitInfo = {
  attempt: number;
  maxAttempts: number;
  waitedSeconds: number;
  nextRetryInSeconds: number;
  provider: string;
  model: string;
  /** Local Date.now() when the latest stall_patient_wait event arrived. */
  receivedAtMs: number;
};

export function stallWaitRemainingSeconds(info: StallWaitInfo, nowMs: number): number {
  const elapsed = Math.max(0, Math.floor((nowMs - info.receivedAtMs) / 1000));
  return Math.max(0, info.nextRetryInSeconds - elapsed);
}

export function stallWaitChipText(info: StallWaitInfo, nowMs: number): string {
  const remain = stallWaitRemainingSeconds(info, nowMs);
  const retryPart =
    info.maxAttempts > 0 ? ` · 自动重试 ${info.attempt}/${info.maxAttempts}` : "";
  const eta = remain > 0 ? `（约 ${remain}s 后）` : "（正在重试…）";
  return `网络较慢，可能要等待更长时间${retryPart}${eta}`;
}

/** Parse a stall_patient_wait tool_progress payload; null when incomplete. */
export function parseStallWaitPayload(data: unknown, nowMs: number): StallWaitInfo | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const attempt = Number(d.attempt);
  const maxAttempts = Number(d.max_attempts);
  const nextRetry = Number(d.next_retry_in_seconds);
  if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts) || !Number.isFinite(nextRetry)) {
    return null;
  }
  const waited = Number(d.waited_seconds);
  return {
    attempt,
    maxAttempts,
    waitedSeconds: Number.isFinite(waited) ? waited : 0,
    nextRetryInSeconds: nextRetry,
    provider: String(d.provider ?? "").trim(),
    model: String(d.model ?? "").trim(),
    receivedAtMs: nowMs,
  };
}
