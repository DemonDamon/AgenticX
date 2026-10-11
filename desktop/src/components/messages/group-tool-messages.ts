import type { Message } from "../../store";
import { isContinuationNoticeMessage } from "../../utils/continuation-notice";
import { isNoisyToolStatusMessage } from "../../utils/noisy-chat-messages";
import { isShowWidgetToolMessage, parseWidgetPayload } from "./widget-preview";

export type GroupedChatRow =
  | { kind: "message"; message: Message }
  | { kind: "tool_group"; groupId: string; messages: Message[] };

function canGroupToolMessage(message: Message): boolean {
  if (message.role !== "tool") return false;
  if (isContinuationNoticeMessage(message)) return false;
  if ((message.toolName ?? "").trim() === "group_progress") return false;
  // Inline widgets render in the message body, not inside TurnToolGroupCard.
  if ((message.toolName ?? "").trim() === "show_widget") return false;
  // Durable Plan artifacts own a standalone interactive card.
  if (["plan_create", "plan_update"].includes((message.toolName ?? "").trim())) return false;
  // Clarification cards must render as standalone interactive rows, not nested ToolCallCards.
  if ((message.toolName ?? "").trim() === "jev") return false;
  const jevKind = String(message.metadata?.kind ?? "").trim();
  if (jevKind === "jev_decision" || jevKind === "jev_kb_gate") return false;
  if (message.clarificationPrompt) return false;
  // Action confirmation cards must also stay standalone (never fold into TurnToolGroupCard).
  if (message.actionConfirmation) return false;
  // Only group the structured tool rows produced by the new SSE path.
  // Legacy history rows often persist as plain text like "工具调用:" /
  // "工具结果(...):"; grouping those together loses the original ReAct
  // replay shape after switching sessions.
  return Boolean(message.toolGroupId || message.toolCallId || (message.toolName ?? "").trim());
}

/**
 * Consecutive `role === "tool"` messages render inside one {@link TurnToolGroupCard}.
 * Legacy rows without structured tool metadata are kept as individual rows so
 * history replay does not collapse the whole ReAct trace into one large group.
 */
function isInProgressShowWidgetPlaceholder(message: Message): boolean {
  if (!isShowWidgetToolMessage(message)) return false;
  if (message.toolStatus !== "running" && message.toolStatus !== "pending") return false;
  return parseWidgetPayload(String(message.content ?? "")) == null;
}

/** Keep only the latest in-progress show_widget slot in the current user turn. */
function omitSupersededShowWidgetPlaceholders(messages: Message[]): Message[] {
  return messages.filter((message, index) => {
    if (!isInProgressShowWidgetPlaceholder(message)) return true;
    for (let i = index + 1; i < messages.length; i += 1) {
      const later = messages[i];
      if (later.role === "user") return true;
      if (isShowWidgetToolMessage(later)) return false;
    }
    return true;
  });
}

export function groupConsecutiveToolMessages(messages: Message[]): GroupedChatRow[] {
  const out: GroupedChatRow[] = [];
  const visibleMessages = omitSupersededShowWidgetPlaceholders(
    messages.filter((m) => !isNoisyToolStatusMessage(m)),
  );
  let i = 0;
  while (i < visibleMessages.length) {
    const m = visibleMessages[i];
    if (m.role !== "tool" || !canGroupToolMessage(m)) {
      out.push({ kind: "message", message: m });
      i += 1;
      continue;
    }
    const group: Message[] = [];
    while (i < visibleMessages.length && canGroupToolMessage(visibleMessages[i])) {
      group.push(visibleMessages[i]);
      i += 1;
    }
    const gid = group[0].toolGroupId ?? `legacy-group:${group[0].id}`;
    out.push({ kind: "tool_group", groupId: gid, messages: group });
  }
  return out;
}

export function isToolGroupInProgress(messages: Message[]): boolean {
  return messages.some((m) => m.toolStatus === "running" || m.toolStatus === "pending");
}

/** True when the group ended by user/runtime cancel, not a completed run. */
export function isToolGroupCancelled(messages: Message[]): boolean {
  if (isToolGroupInProgress(messages)) return false;
  return messages.some((m) => m.toolStatus === "cancelled");
}

function findLastGroupedToolMessageId(messages: Message[]): string | undefined {
  const visibleMessages = messages.filter((m) => !isNoisyToolStatusMessage(m));
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    const message = visibleMessages[i];
    if (message.role === "tool" && canGroupToolMessage(message)) {
      return message.id;
    }
  }
  return undefined;
}

function hasAssistantTailAfterToolGroup(contextMessages: Message[], groupMessages: Message[]): boolean {
  const lastGroupMessageId = groupMessages[groupMessages.length - 1]?.id;
  if (!lastGroupMessageId) return false;
  const visibleMessages = contextMessages.filter((m) => !isNoisyToolStatusMessage(m));
  const lastGroupIndex = visibleMessages.findIndex((m) => m.id === lastGroupMessageId);
  if (lastGroupIndex < 0) return false;
  for (let i = lastGroupIndex + 1; i < visibleMessages.length; i += 1) {
    const message = visibleMessages[i];
    if (message.role !== "assistant") continue;
    if (message.id === "__stream__") return true;
    if ((message.content ?? "").trim()) return true;
  }
  return false;
}

/**
 * Between sequential tool calls in the same turn, every row in the group may
 * briefly flip to "done" before the next call arrives. Keep the group header
 * in the in-progress state until the turn moves on to assistant output.
 */
export function shouldHoldToolGroupProgress(
  contextMessages: Message[],
  groupMessages: Message[],
  isStreamingCurrentSession: boolean,
): boolean {
  if (!isStreamingCurrentSession) return false;
  if (groupMessages.length === 0) return false;
  if (isToolGroupInProgress(groupMessages)) return false;
  const lastGroupMessageId = groupMessages[groupMessages.length - 1]?.id;
  if (!lastGroupMessageId) return false;
  if (findLastGroupedToolMessageId(contextMessages) !== lastGroupMessageId) return false;
  if (hasAssistantTailAfterToolGroup(contextMessages, groupMessages)) return false;
  return true;
}
