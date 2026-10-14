import { NextResponse } from "next/server";
import { resolveDesktopIdentity } from "../../../../../../../lib/desktop-auth";
import { writeExecutionFailureNotice } from "../../../../../../../lib/worker-tasks/notices";
import { failTask, getAgentTask, WorkerTaskConflictError } from "../../../../../../../lib/worker-tasks";
import {
  readDeviceId,
  readFailureReason,
  readJsonObject,
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
    const errorText = readFailureReason(body.error);
    const task = await getAgentTask(identity.tenantId, taskId);
    if (
      !task ||
      task.status !== "claimed" ||
      task.claimedByUserId !== identity.userId ||
      task.claimedByDevice !== deviceId
    ) {
      throw new WorkerTaskConflictError();
    }
    const failed = await failTask({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId,
      taskId,
      error: errorText,
    });
    await writeExecutionFailureNotice(failed, errorText);
    return NextResponse.json({ task_id: failed.id, status: failed.status });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
