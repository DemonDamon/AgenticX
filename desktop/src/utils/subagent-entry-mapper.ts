import type { SubAgent } from "../store";

/**
 * SSE `subagent_started` 事件 → 工作区子智能体条目的纯映射。
 *
 * 归属规则（与后端 SubAgentRunStore 的 owner 模型一致）：
 * - 委派运行（dlg-*，delegation=true）的卡片归发起委派的会话（requestSessionId），
 *   目标分身会话只写入 avatarSessionId，供「对话」跳转使用；
 * - spawn 的临时子智能体（sa-*）归 spawn 它的会话。
 * - 防误绑：委派事件若到达在分身会话自身的流上（avatar_session_id === requestSessionId），
 *   返回 null 跳过登记，避免分身 pane 重复跟踪同一条委派运行。
 */
export type SubAgentStartedEntry = Pick<
  SubAgent,
  "name" | "role" | "task" | "provider" | "model"
> & {
  id: string;
  sessionId: string;
  avatarSessionId?: string;
  kind: "delegate" | "subagent";
  status: "running";
  currentAction: string;
};

export function mapStartedEvent(
  payload: Record<string, unknown> | undefined | null,
  requestSessionId: string,
): SubAgentStartedEntry | null {
  const data = payload ?? {};
  const agentId = String(data.agent_id ?? "").trim();
  if (!agentId) return null;
  const isDelegation = Boolean(data.delegation);
  const avatarSessionId =
    typeof data.avatar_session_id === "string" ? data.avatar_session_id.trim() : "";
  if (isDelegation && avatarSessionId && requestSessionId && avatarSessionId === requestSessionId) {
    return null;
  }
  return {
    id: agentId,
    name: String(data.name ?? agentId),
    role: String(data.role ?? (isDelegation ? "delegated avatar" : "worker")),
    provider: typeof data.provider === "string" && data.provider ? data.provider : undefined,
    model: typeof data.model === "string" && data.model ? data.model : undefined,
    task: String(data.task ?? ""),
    sessionId: requestSessionId,
    avatarSessionId: avatarSessionId || undefined,
    kind: isDelegation ? "delegate" : "subagent",
    status: "running",
    currentAction: isDelegation ? "委派执行中" : "执行中",
  };
}

/**
 * SSE 终态事件（paused/completed/error）的会话字段 patch：
 * 只更新 avatarSessionId，绝不覆盖 sessionId（委派卡片的归属在 started 时已定）。
 */
export function mapTerminalSessionPatch(
  payload: Record<string, unknown> | undefined | null,
): { avatarSessionId?: string } {
  const data = payload ?? {};
  const avatarSessionId =
    typeof data.avatar_session_id === "string" ? data.avatar_session_id.trim() : "";
  return avatarSessionId ? { avatarSessionId } : {};
}
