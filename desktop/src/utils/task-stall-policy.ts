/**
 * Stall detection thresholds and helpers for long-running Machi tasks.
 */

import type { ParsedTodo, TodoItem } from "../components/TodoUpdateCard";
import type { Message } from "../store";

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

export type StallPhase = "none" | "stall" | "exhausted";

export function messageLooksLikeAssistantFinal(message: Message | undefined): boolean {
  if (!message) return false;
  if (message.role !== "assistant") return false;
  const content = String(message.content ?? "").trim();
  if (!content) return false;
  if (message.id === "__stream__") return false;
  return true;
}

/** Whether desktop auto-nudge may fire for the current stall + execution state. */
export function shouldAllowStallAutoNudge(
  stallState: StallPhase,
  executionState: string | undefined,
): boolean {
  if (stallState !== "stall") return false;
  const state = (executionState || "").trim();
  return state === "running" || state === "interrupted" || state === "idle";
}

/**
 * Align sticky task bar with session execution: when the agent is no longer
 * running but todo_write still has in_progress, stop ghost spinners.
 */
export function resolveStickyTodoDisplay(
  parsed: ParsedTodo,
  liveness: "active" | "stalled" | "idle",
  executionState?: string
): ParsedTodo {
  if (liveness === "active" || liveness === "stalled") {
    return parsed;
  }
  const state = (executionState || "").trim();
  const items: TodoItem[] = parsed.items.map((item) => {
    if (item.status !== "in_progress") return item;
    if (state === "interrupted") {
      return { ...item, status: "pending" };
    }
    return { ...item, status: "completed" };
  });
  const completed = items.filter((item) => item.status === "completed").length;
  const total = parsed.total > 0 ? parsed.total : items.length;
  return { items, completed, total };
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

/** Channel C: session ended idle but last visible message is not a final assistant reply. */
export function shouldTriggerIncompleteEndStall(
  executionState: string | undefined,
  sseActive: boolean,
  lastMessage: Message | undefined,
  graceElapsedMs: number
): boolean {
  if (sseActive) return false;
  if (graceElapsedMs < CHANNEL_C_GRACE_MS) return false;
  const state = (executionState || "").trim();
  // Only idle — user-interrupted sessions are handled via userStopped stall suppress.
  if (state !== "idle") return false;
  return !messageLooksLikeAssistantFinal(lastMessage);
}

/** Fast fallback model suggestions when current model stalls (display labels). */
export const STALL_MODEL_FALLBACKS: Array<{ provider: string; model: string; label: string }> = [
  { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek / deepseek-chat" },
  { provider: "zhipu", model: "glm-4-flash", label: "智谱 / glm-4-flash" },
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI / gpt-4o-mini" },
];
