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

/**
 * Consecutive `role === "tool"` messages render inside one {@link TurnToolGroupCard}.
 * Legacy rows without `toolGroupId` still group when adjacent to reduce vertical noise.
 */
export function groupConsecutiveToolMessages(messages: Message[]): GroupedChatRow[] {
  const out: GroupedChatRow[] = [];
  const visibleMessages = messages.filter((m) => !isNoisyToolStatusMessage(m));
  let i = 0;
  while (i < visibleMessages.length) {
    const m = visibleMessages[i];
    if (m.role !== "tool") {
      out.push({ kind: "message", message: m });
      i += 1;
      continue;
    }
    const group: Message[] = [];
    while (i < visibleMessages.length && visibleMessages[i].role === "tool") {
      group.push(visibleMessages[i]);
      i += 1;
    }
    if (group.length === 1) {
      out.push({ kind: "message", message: group[0] });
    } else {
      const gid = group[0].toolGroupId ?? `legacy-group:${group[0].id}`;
      out.push({ kind: "tool_group", groupId: gid, messages: group });
    }
  }
  return out;
}
