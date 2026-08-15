export type GroupMemberActivityState = "idle" | "running" | "replied";

export type GroupMemberActivity = {
  state: GroupMemberActivityState;
  replies: number;
  toolCalls: number;
  lastTs: number;
};

type ActivityMessage = {
  role: string;
  agentId?: string;
  toolName?: string;
  timestamp?: number;
};

/** 从窗格消息推导每位群成员的真实活动状态（不依赖 LLM 文案）。 */
export function resolveGroupMemberActivity(
  messages: ActivityMessage[],
  avatarIds: string[],
  activeAgentIds?: string[],
): Map<string, GroupMemberActivity> {
  const active = new Set((activeAgentIds ?? []).filter(Boolean));
  const replies = new Map<string, number>();
  const toolCalls = new Map<string, number>();
  const lastTs = new Map<string, number>();

  for (const msg of messages) {
    const agentId = String(msg.agentId ?? "").trim();
    if (!agentId) continue;
    const ts = typeof msg.timestamp === "number" ? msg.timestamp : 0;
    if (msg.role === "assistant") {
      replies.set(agentId, (replies.get(agentId) ?? 0) + 1);
      if (ts >= (lastTs.get(agentId) ?? 0)) lastTs.set(agentId, ts);
    } else if (msg.role === "tool") {
      toolCalls.set(agentId, (toolCalls.get(agentId) ?? 0) + 1);
      if (ts >= (lastTs.get(agentId) ?? 0)) lastTs.set(agentId, ts);
    }
  }

  const out = new Map<string, GroupMemberActivity>();
  for (const id of avatarIds) {
    const replyCount = replies.get(id) ?? 0;
    const toolCount = toolCalls.get(id) ?? 0;
    let state: GroupMemberActivityState = "idle";
    if (active.has(id)) state = "running";
    else if (replyCount > 0) state = "replied";
    out.set(id, {
      state,
      replies: replyCount,
      toolCalls: toolCount,
      lastTs: lastTs.get(id) ?? 0,
    });
  }
  return out;
}

export function groupMemberActivityTitle(activity: GroupMemberActivity): string {
  if (activity.state === "running") return "执行中";
  if (activity.state === "replied") return `已回复 ${activity.replies} 次`;
  return "未执行";
}
