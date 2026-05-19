/**
 * Stall detection thresholds and helpers for long-running Machi tasks.
 */

import type { Message } from "../store";

export const STALL_SSE_SILENCE_MS = 90_000;
export const STALL_RUNNING_SILENCE_MS = 90_000;
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
