import type { Message } from "../../store";

export type GroupedChatRow =
  | { kind: "message"; message: Message }
  | { kind: "tool_group"; groupId: string; messages: Message[] };

/**
 * Consecutive `role === "tool"` messages render inside one {@link TurnToolGroupCard}.
 * Legacy rows without `toolGroupId` still group when adjacent to reduce vertical noise.
 */
export function groupConsecutiveToolMessages(messages: Message[]): GroupedChatRow[] {
  const out: GroupedChatRow[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role !== "tool") {
      out.push({ kind: "message", message: m });
      i += 1;
      continue;
    }
    const group: Message[] = [];
    while (i < messages.length && messages[i].role === "tool") {
      group.push(messages[i]);
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
