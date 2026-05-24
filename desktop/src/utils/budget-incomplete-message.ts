import type { Message } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";

/** Trailing punctuation that suggests an assistant reply was cut off mid-thought. */
const UNFINISHED_TRAILING_RE = /[:：,，;；、—…]+$/u;

export function assistantBodyText(message: Message): string {
  if (message.role !== "assistant") return "";
  const parsed = parseReasoningContent(message.content);
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const body = hasThinkTag ? (parsed?.response ?? "") : message.content;
  return String(body ?? "").trim();
}

export function looksLikeUnfinishedAssistantBody(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  return UNFINISHED_TRAILING_RE.test(trimmed);
}

export function findAssistantBeforeBudgetExceeded(messages: Message[]): Message | null {
  let budgetIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    if (
      msg.noticeKind === "budget_exceeded" ||
      /Token budget exceeded/i.test(String(msg.content ?? ""))
    ) {
      budgetIdx = i;
      break;
    }
  }
  if (budgetIdx < 0) return null;
  for (let i = budgetIdx - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    if (!assistantBodyText(msg)) continue;
    return msg;
  }
  return null;
}

export function shouldShowBudgetIncompleteHint(
  message: Message,
  messages: Message[],
  budgetExceededActive: boolean,
): boolean {
  if (!budgetExceededActive) return false;
  const anchor = findAssistantBeforeBudgetExceeded(messages);
  if (!anchor || anchor.id !== message.id) return false;
  return looksLikeUnfinishedAssistantBody(assistantBodyText(message));
}
