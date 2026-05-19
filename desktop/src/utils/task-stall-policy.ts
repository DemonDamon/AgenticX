/**
 * Stall detection thresholds and helpers for long-running Machi tasks.
 */

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

/** Channel C: session ended idle/interrupted but last visible message is not a final assistant reply. */
export function shouldTriggerIncompleteEndStall(
  executionState: string | undefined,
  sseActive: boolean,
  lastMessage: Message | undefined,
  graceElapsedMs: number
): boolean {
  if (sseActive) return false;
  if (graceElapsedMs < CHANNEL_C_GRACE_MS) return false;
  const state = (executionState || "").trim();
  if (state !== "idle" && state !== "interrupted") return false;
  return !messageLooksLikeAssistantFinal(lastMessage);
}

/** Fast fallback model suggestions when current model stalls (display labels). */
export const STALL_MODEL_FALLBACKS: Array<{ provider: string; model: string; label: string }> = [
  { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek / deepseek-chat" },
  { provider: "zhipu", model: "glm-4-flash", label: "智谱 / glm-4-flash" },
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI / gpt-4o-mini" },
];
