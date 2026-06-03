/**
 * Stall detection thresholds and helpers for long-running Near tasks.
 */

import type { ParsedTodo, TodoItem } from "../components/TodoUpdateCard";
import type { Message } from "../store";
import { assistantBodyText, looksLikeUnfinishedAssistantBody } from "./budget-incomplete-message";

/** Default stall warning threshold (seconds) — overridable via Settings → 工具 → 长任务停滞与续跑. */
export const DEFAULT_STALL_DETECT_SILENCE_SECONDS = 90;

/** Legacy constants; prefer {@link stallDetectSilenceMs} with runtime config. */
export const STALL_SSE_SILENCE_MS = DEFAULT_STALL_DETECT_SILENCE_SECONDS * 1000;
export const STALL_RUNNING_SILENCE_MS = DEFAULT_STALL_DETECT_SILENCE_SECONDS * 1000;

export const STALL_DETECT_SILENCE_MIN_SECONDS = 30;
export const STALL_DETECT_SILENCE_MAX_SECONDS = 300;

export function clampStallDetectSilenceSeconds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_STALL_DETECT_SILENCE_SECONDS;
  return Math.max(
    STALL_DETECT_SILENCE_MIN_SECONDS,
    Math.min(STALL_DETECT_SILENCE_MAX_SECONDS, Math.round(n)),
  );
}

export function stallDetectSilenceMs(seconds?: number): number {
  return clampStallDetectSilenceSeconds(seconds) * 1000;
}

export const CHANNEL_C_GRACE_MS = 5_000;

const INTERRUPTED_ASSISTANT_PLACEHOLDERS = new Set(["（已中断）", "(已中断)"]);

export type StallPhase = "none" | "stall" | "exhausted";

export type StallAutoNudgeContext = {
  /** Live SSE subscription for the displayed session. */
  sseActive?: boolean;
  /** User stop guard or an in-flight chat request for this session. */
  runInFlight?: boolean;
};

export function messageLooksLikeAssistantFinal(message: Message | undefined): boolean {
  if (!message) return false;
  if (message.role !== "assistant") return false;
  if (message.id === "__stream__") return false;
  const content = assistantBodyText(message);
  if (!content) return false;
  if (looksLikeUnfinishedAssistantBody(content)) return false;
  return true;
}

/**
 * True when the last user turn already has a non-empty assistant reply.
 * Aligns with backend ``SessionManager._last_turn_has_completed_reply``:
 * scan all assistant messages after the last user message, not only the
 * array tail (tool rows / reasoning-only rows may follow the answer).
 */
export function lastTurnHasCompletedAssistantReply(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let idx = 0; idx < messages.length; idx += 1) {
    if (messages[idx]?.role === "user") lastUserIdx = idx;
  }
  if (lastUserIdx < 0) return false;
  for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    const content = assistantBodyText(msg);
    if (!content) continue;
    if (INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(content)) continue;
    return true;
  }
  return false;
}

/**
 * True when a newer user turn started after this todo snapshot (and no newer
 * todo_write replaced it — caller should pass the latest picked snapshot index).
 */
export function isTodoSnapshotSuperseded(messages: Message[], todoIndex: number): boolean {
  if (todoIndex < 0 || todoIndex >= messages.length) return false;
  for (let i = todoIndex + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") return true;
  }
  return false;
}

/** Whether desktop auto-nudge may fire for the current stall + execution state. */
export function shouldAllowStallAutoNudge(
  stallState: StallPhase,
  executionState: string | undefined,
  budgetExceeded = false,
  ctx?: StallAutoNudgeContext,
): boolean {
  if (budgetExceeded) return false;
  if (stallState !== "stall") return false;
  const state = (executionState || "").trim();
  if (state === "running" || state === "interrupted") return true;
  if (state === "idle") {
    // Channel C (idle, no live SSE): manual recovery only — auto /continue pollutes
    // completed sessions after app restart when stall was a false positive.
    if (!ctx?.sseActive && !ctx?.runInFlight) return false;
    return true;
  }
  return false;
}

/**
 * Align sticky task bar with session execution: when the agent is no longer
 * running but todo_write still has in_progress, stop ghost spinners.
 *
 * Engineering fallback for "model forgot to call todo_write at the end":
 * when `promotePending` is true (caller has verified the agent continued
 * working after the last todo snapshot AND produced a complete final
 * assistant reply), residual `pending` items are also promoted to
 * `completed`. This prevents the sticky bar from being stuck at e.g. 1/2
 * after the agent actually delivered everything but skipped the closing
 * todo update.
 */
export function resolveStickyTodoDisplay(
  parsed: ParsedTodo,
  liveness: "active" | "stalled" | "idle",
  executionState?: string,
  opts?: { promotePending?: boolean }
): ParsedTodo {
  if (liveness === "active" || liveness === "stalled") {
    return parsed;
  }
  const state = (executionState || "").trim();
  const promotePending = !!opts?.promotePending && state !== "interrupted";
  const items: TodoItem[] = parsed.items.map((item) => {
    if (item.status === "in_progress") {
      if (state === "interrupted") {
        return { ...item, status: "pending" };
      }
      if (promotePending) {
        return { ...item, status: "completed" };
      }
      return { ...item, status: "pending" };
    }
    if (item.status === "pending" && promotePending) {
      return { ...item, status: "completed" };
    }
    return item;
  });
  const completed = items.filter((item) => item.status === "completed").length;
  const total = parsed.total > 0 ? parsed.total : items.length;
  return { items, completed, total };
}

/**
 * True when the displayed session changed and the pane must reset its
 * per-session transient stall detectors (silence clock / stallState /
 * prevExecutionState). Without this, a still-running (and possibly hung)
 * background session leaks its "已停滞 Ns / 该任务可能已中断" state onto a
 * sibling session that already finished, because those detectors live on the
 * single ChatPane instance and are not keyed per session.
 */
export function shouldResetStallDetectorsOnSessionSwitch(
  prevSessionId: string | undefined,
  nextSessionId: string | undefined,
): boolean {
  const prev = (prevSessionId || "").trim();
  const next = (nextSessionId || "").trim();
  if (!next) return false;
  return prev !== next;
}

/** While the user requested stop, suppress stall re-detection until execution settles. */
export function shouldSuppressStallDetection(
  runGuardSessionId: string | undefined,
  sessionId: string,
  userStopped?: boolean
): boolean {
  const sid = (sessionId || "").trim();
  if (!sid) return false;
  if (userStopped) return true;
  const guard = (runGuardSessionId || "").trim();
  return Boolean(guard && guard === sid);
}

/** Channel C: session ended idle but the last user turn has no completed assistant reply. */
export function shouldTriggerIncompleteEndStall(
  executionState: string | undefined,
  sseActive: boolean,
  messages: Message[],
  graceElapsedMs: number,
): boolean {
  if (sseActive) return false;
  if (graceElapsedMs < CHANNEL_C_GRACE_MS) return false;
  const state = (executionState || "").trim();
  // Only idle — user-interrupted sessions are handled via userStopped stall suppress.
  if (state !== "idle") return false;
  return !lastTurnHasCompletedAssistantReply(messages);
}

/** Fast fallback model suggestions when current model stalls (display labels). */
export const STALL_MODEL_FALLBACKS: Array<{ provider: string; model: string; label: string }> = [
  { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek / deepseek-chat" },
  { provider: "zhipu", model: "glm-4-flash", label: "智谱 / glm-4-flash" },
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI / gpt-4o-mini" },
];
