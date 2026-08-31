import type { Message } from "../store";
import { isWidgetFlowRetryNotice } from "./context-notice";
import { isOrphanFormattedToolResultMessage } from "./orphan-formatted-tool";

const NOISY_TOOL_STATUS_CONTENT = new Set([
  "后台任务已完成",
  "已发送中断请求",
  "已中断任务",
  "已中断当前生成",
  "已中断上一轮生成，开始处理新消息",
]);

const CONFIRM_RECEIPT_SUFFIXES = [
  "确认通过，继续执行",
  "确认拒绝，执行终止",
  "确认拒绝，已取消",
] as const;

/** Auto-approve / inline-confirm receipts — activity card owns the flash, not chat history. */
export function isEphemeralConfirmReceiptMessage(
  message: Pick<Message, "role" | "content" | "toolName" | "toolCallId" | "inlineConfirm">,
): boolean {
  if (message.role !== "tool") return false;
  if (message.inlineConfirm) return false;
  if ((message.toolName ?? "").trim()) return false;
  if ((message.toolCallId ?? "").trim()) return false;
  const normalized = normalizeNoisyToolStatusContent(String(message.content ?? ""));
  return CONFIRM_RECEIPT_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`：${suffix}`),
  );
}

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
  message: Pick<Message, "role" | "content" | "toolName" | "toolCallId" | "toolGroupId" | "noticeKind" | "inlineConfirm">,
): boolean {
  if (message.role !== "tool") return false;
  if (isWidgetFlowRetryNotice(message)) return true;
  if (isOrphanFormattedToolResultMessage(message)) return true;
  if (isEphemeralConfirmReceiptMessage(message)) return true;
  const toolName = (message.toolName ?? "").trim();
  if (toolName === "check_resources") return true;
  // StickyTaskBar (输入框上方「任务进度」) is the sole surface for todo_write snapshots.
  // Keep the message in the store for progress parsing; hide the inline duplicate card.
  if (toolName === "todo_write") return true;
  const content = String(message.content ?? "").trim();
  if (content.startsWith("🗂 任务清单更新")) return true;
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
