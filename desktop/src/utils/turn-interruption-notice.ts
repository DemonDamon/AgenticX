import type { Message } from "../store";

export type TurnInterruptionCause =
  | "user_interrupt"
  | "runtime_failure"
  | "client_disconnect"
  | "cancelled"
  | "no_final"
  | "deferred_action"
  | "suspected_truncated_final"
  | "unknown";

type NoticePick = Pick<Message, "role" | "content" | "metadata">;

export const TURN_INTERRUPTED_KIND = "turn_interrupted";

/** Short toast when SSE ends without final — disk row is the source of truth. */
export const TURN_INTERRUPTED_TOAST =
  "本轮请求已中断，正在同步状态…";

export function isTurnInterruptionNoticeMessage(message: NoticePick): boolean {
  if (message.role !== "tool") return false;
  const kind = (message.metadata as Record<string, unknown> | undefined)?.kind;
  if (kind === TURN_INTERRUPTED_KIND) return true;
  const text = String(message.content ?? "").trim();
  return (
    text.includes("未收到模型最终响应")
    && (text.includes("恢复执行") || text.includes("恢复执行」"))
  );
}

/** Detectors that are safe to auto-resume once without unattended mode. */
const AUTO_RESUME_DETECTORS = new Set([
  "streamed_tool_call_truncated",
  "llm_stream_timeout",
  "llm_round_timeout",
]);

export function parseTurnInterruptionNotice(message: NoticePick): {
  cause: TurnInterruptionCause;
  text: string;
  failureSummary: string;
  detector: string;
} | null {
  if (!isTurnInterruptionNoticeMessage(message)) return null;
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const causeRaw = String(meta.cause ?? "unknown").trim() as TurnInterruptionCause;
  const cause: TurnInterruptionCause =
    causeRaw === "user_interrupt"
    || causeRaw === "runtime_failure"
    || causeRaw === "client_disconnect"
    || causeRaw === "cancelled"
    || causeRaw === "no_final"
    || causeRaw === "deferred_action"
    || causeRaw === "suspected_truncated_final"
      ? causeRaw
      : "unknown";
  const text = String(message.content ?? "").trim();
  if (!text) return null;
  const failureSummary = String(meta.failure_summary ?? "").trim();
  const detector = String(meta.detector ?? "").trim().toLowerCase();
  return { cause, text, failureSummary, detector };
}

/**
 * True when a turn_interrupted notice should auto-continue once (Cursor-like),
 * without requiring global「无人值守」. User interrupts are never auto-resumed.
 */
export function shouldAutoResumeTruncationInterruption(message: NoticePick): boolean {
  const parsed = parseTurnInterruptionNotice(message);
  if (!parsed) return false;
  if (parsed.cause === "user_interrupt") return false;
  if (AUTO_RESUME_DETECTORS.has(parsed.detector)) return true;
  return parsed.text.includes("工具参数流式截断") || parsed.text.includes("模型流式响应超时");
}

export function turnInterruptionToastForCause(cause: TurnInterruptionCause | null): string {
  if (cause === "user_interrupt") {
    return "已按你的请求中断当前生成。";
  }
  return TURN_INTERRUPTED_TOAST;
}
