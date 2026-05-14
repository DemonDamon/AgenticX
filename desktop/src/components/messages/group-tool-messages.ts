import type { Message } from "../../store";

function isNoisyToolStatusMessage(message: Message): boolean {
  if (message.role !== "tool") return false;
  if ((message.toolName ?? "").trim()) return false;
  const content = String(message.content ?? "").trim();
  return content === "后台任务已完成" || content === "已发送中断请求";
}

export type GroupedChatRow =
  | { kind: "message"; message: Message }
  | { kind: "tool_group"; groupId: string; messages: Message[] };

function canGroupToolMessage(message: Message): boolean {
  if (message.role !== "tool") return false;
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
export function groupConsecutiveToolMessages(messages: Message[]): GroupedChatRow[] {
  const out: GroupedChatRow[] = [];
  const visibleMessages = messages.filter((m) => !isNoisyToolStatusMessage(m));
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
