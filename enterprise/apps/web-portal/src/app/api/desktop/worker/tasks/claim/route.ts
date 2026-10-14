import { NextResponse } from "next/server";
import { getAgent } from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import { listEligibleDesktopWorkerAgents, toWorkerAgentCard } from "../../../../../../lib/worker-tasks/eligibility";
import { writeSweepNotice } from "../../../../../../lib/worker-tasks/notices";
import { claimNextTask, sweepExpired } from "../../../../../../lib/worker-tasks";
import {
  readDeviceId,
  readJsonObject,
  workerErrorResponse,
  workerUnauthorized,
} from "../../../../../../lib/worker-tasks/protocol";

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const body = await readJsonObject(request);
    const deviceId = readDeviceId(body.device_id);
    const swept = await sweepExpired(identity.tenantId);
    for (const task of swept) {
      await writeSweepNotice(task);
    }
    const agents = await listEligibleDesktopWorkerAgents(identity);
    const task = await claimNextTask({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId,
      agentIds: agents.map((agent) => agent.id),
    });
    if (!task) return NextResponse.json({ task: null });
    const known = agents.find((agent) => agent.id === task.agentId);
    const agent = known ?? (await getAgent(identity.tenantId, task.agentId));
    return NextResponse.json({
      task: {
        id: task.id,
        agent: toWorkerAgentCard(agent),
        room_id: task.roomId,
        input: task.input,
      },
    });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
