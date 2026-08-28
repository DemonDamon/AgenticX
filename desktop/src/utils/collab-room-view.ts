export type RoomMessage = {
  id: string;
  room_id: string;
  seq: number;
  sender_type: "human" | "meta" | "agent" | "system" | string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at?: string;
};

export type RoomSummary = {
  id: string;
  title: string;
  member_count: number;
  last_seq: number;
};

export type RoomMember = {
  id: string;
  member_type: string;
  member_id: string;
  display_name: string;
  room_role: string;
};

export type RoomStreamStatus = "connecting" | "live" | "retrying" | "revoked" | "error";

const OPTIMISTIC_SEQ = Number.MAX_SAFE_INTEGER;

export function firstScreenAfterSeq(lastSeq: number, want = 100): number {
  return Math.max(0, lastSeq - want);
}

export function upsertBySeq(list: RoomMessage[], incoming: RoomMessage): RoomMessage[] {
  const next = list.filter((item) => item.id !== incoming.id);
  next.push(incoming);
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

export function nextCursor(list: RoomMessage[]): number {
  let max = 0;
  for (const item of list) {
    if (item.seq >= OPTIMISTIC_SEQ) continue;
    if (item.seq > max) max = item.seq;
  }
  return max;
}

export function bubbleKind(
  message: RoomMessage,
  currentUserId: string,
): "self" | "other" | "meta" | "system" {
  if (message.sender_type === "system") return "system";
  if (message.sender_type === "meta") return "meta";
  if (message.sender_id === currentUserId) return "self";
  return "other";
}

export function visibleContent(content: string): string {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || content.trim();
}

export function statusLabel(status: RoomStreamStatus): string {
  if (status === "connecting") return "连接中";
  if (status === "live") return "实时";
  if (status === "retrying") return "重连中";
  if (status === "revoked") return "你已被移出该房间";
  return "云房间服务暂时不可用";
}

export function memberKey(member: RoomMember): string {
  return `${member.member_type}:${member.member_id}`;
}

/** 成员集合是否变化（加人 / 移出 / 改名）。仅比身份与显示名，不比行主键。 */
export function membersChanged(prev: RoomMember[], next: RoomMember[]): boolean {
  if (prev.length !== next.length) return true;
  const prevKeys = prev.map((item) => `${memberKey(item)}\0${item.display_name}`).sort();
  const nextKeys = next.map((item) => `${memberKey(item)}\0${item.display_name}`).sort();
  return prevKeys.some((key, index) => key !== nextKeys[index]);
}
