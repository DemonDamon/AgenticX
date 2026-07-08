import type { Message } from "../store";
import { isOrphanFormattedToolResultMessage } from "./orphan-formatted-tool";

const NOISY_TOOL_STATUS_CONTENT = new Set([
  "后台任务已完成",
  "已发送中断请求",
  "已中断任务",
  "已中断当前生成",
  "已中断上一轮生成，开始处理新消息",
]);

const INTERRUPTED_ASSISTANT_PLACEHOLDERS = new Set(["（已中断）", "(已中断)"]);

/** Strip leading status emoji so SSE rows like `❌ 已中断当前生成` match noisy filters. */
export function normalizeNoisyToolStatusContent(content: string): string {
  return String(content ?? "")
    .trim()
    .replace(/^[✅🔧⚠️❌🗣📌⏹]\s*/u, "")
    .trim();
}

/** Runtime STOP_MESSAGE / interrupt ack — UI uses turn_interrupted instead. */
export function isEphemeralStopErrorText(text: string): boolean {
  const normalized = normalizeNoisyToolStatusContent(text);
  return (
    normalized === "已中断当前生成"
    || normalized === "已中断任务"
    || normalized === "已发送中断请求"
  );
}

/** Ephemeral meta tool rows that duplicate TurnInterruptionNoticeLine or add wrench noise. */
export function isNoisyToolStatusMessage(
  message: Pick<Message, "role" | "content" | "toolName" | "toolCallId" | "toolGroupId">,
): boolean {
  if (message.role !== "tool") return false;
  if (isOrphanFormattedToolResultMessage(message)) return true;
  const toolName = (message.toolName ?? "").trim();
  if (toolName === "check_resources") return true;
  const content = String(message.content ?? "").trim();
  const normalized = normalizeNoisyToolStatusContent(content);
  if (isEphemeralStopErrorText(content)) return true;
  if (!toolName && /^[✅🔧⚠️❌🗣]?\s*check_resources\b/i.test(content)) return true;
  if (toolName) return false;
  return NOISY_TOOL_STATUS_CONTENT.has(normalized);
}

/** Barge-in placeholder assistant rows — hidden in UI; turn_interrupted notice covers display. */
export function isInterruptedAssistantPlaceholder(
  message: Pick<Message, "role" | "content">,
): boolean {
  if (message.role !== "assistant") return false;
  const text = String(message.content ?? "").trim();
  return INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(text);
}
