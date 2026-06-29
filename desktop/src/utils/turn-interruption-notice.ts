import type { Message } from "../store";

export type TurnInterruptionCause =
  | "user_interrupt"
  | "runtime_failure"
  | "client_disconnect"
  | "cancelled"
  | "no_final"
  | "deferred_action"
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

export function parseTurnInterruptionNotice(message: NoticePick): {
  cause: TurnInterruptionCause;
  text: string;
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
      ? causeRaw
      : "unknown";
  const text = String(message.content ?? "").trim();
  if (!text) return null;
  return { cause, text };
}

export function turnInterruptionToastForCause(cause: TurnInterruptionCause | null): string {
  if (cause === "user_interrupt") {
    return "已按你的请求中断当前生成。";
  }
  return TURN_INTERRUPTED_TOAST;
}
