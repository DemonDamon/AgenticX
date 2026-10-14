import { NextResponse } from "next/server";
import { getAgent } from "@agenticx/iam-core";
import { appendAgentMessageAsSystem } from "../../../../../../../lib/collab-room";
import { resolveDesktopIdentity } from "../../../../../../../lib/desktop-auth";
import { completeTask, getAgentTask, WorkerTaskConflictError } from "../../../../../../../lib/worker-tasks";
import {
  readDeviceId,
  readJsonObject,
  readReplyContent,
  readToolSteps,
  workerErrorResponse,
  workerUnauthorized,
} from "../../../../../../../lib/worker-tasks/protocol";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const { taskId } = await context.params;
    const body = await readJsonObject(request);
    const deviceId = readDeviceId(body.device_id);
    const content = readReplyContent(body.content);
    const toolSteps = readToolSteps(body.tool_steps);
    const task = await getAgentTask(identity.tenantId, taskId);
    if (
      !task ||
      task.status !== "claimed" ||
      task.claimedByUserId !== identity.userId ||
      task.claimedByDevice !== deviceId
    ) {
      throw new WorkerTaskConflictError();
    }
    const agent = await getAgent(identity.tenantId, task.agentId);
    const message = await appendAgentMessageAsSystem(identity.tenantId, task.roomId, {
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      content,
      metadata: {
        runtime: "desktop_worker",
        reply_to: task.triggerMessageId,
        worker_user_id: identity.userId,
        worker_device: deviceId,
        ...(toolSteps !== undefined ? { tool_steps: toolSteps } : {}),
      },
    });
    const completed = await completeTask({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId,
      taskId,
      resultMessageId: message.id,
    });
    return NextResponse.json({ task_id: completed.id, result_message_id: message.id });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
