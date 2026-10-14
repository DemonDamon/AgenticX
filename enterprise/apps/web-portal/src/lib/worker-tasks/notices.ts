import { getAgent } from "@agenticx/iam-core";
import { appendAgentMessageAsSystem } from "../collab-room";
import type { AgentTask } from "./types";

async function agentName(tenantId: string, agentId: string): Promise<string> {
  try {
    const agent = await getAgent(tenantId, agentId);
    return agent.displayName;
  } catch {
    return "智能体";
  }
}

export async function writeSweepNotice(task: AgentTask): Promise<void> {
  const name = await agentName(task.tenantId, task.agentId);
  const content =
    task.status === "failed"
      ? `智能体「${name}」多次领取未完成`
      : task.status === "expired"
        ? `智能体「${name}」24 小时内没有桌面执行端领取`
        : null;
  if (!content) return;
  await appendAgentMessageAsSystem(task.tenantId, task.roomId, {
    senderType: "system",
    senderId: "system",
    senderName: "系统",
    content,
  });
}

export async function writeExecutionFailureNotice(
  task: Pick<AgentTask, "tenantId" | "roomId" | "agentId">,
  error: string,
): Promise<void> {
  const name = await agentName(task.tenantId, task.agentId);
  await appendAgentMessageAsSystem(task.tenantId, task.roomId, {
    senderType: "system",
    senderId: "system",
    senderName: "系统",
    content: `智能体「${name}」执行失败：${error.slice(0, 200)}`,
  });
}
