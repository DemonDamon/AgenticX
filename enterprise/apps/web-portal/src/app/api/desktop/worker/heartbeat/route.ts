import { NextResponse } from "next/server";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import { listEligibleDesktopWorkerAgents, toWorkerAgentCard } from "../../../../../lib/worker-tasks/eligibility";
import { recordHeartbeat } from "../../../../../lib/worker-tasks";
import {
  readDeviceId,
  readDeviceName,
  readJsonObject,
  workerErrorResponse,
  workerUnauthorized,
} from "../../../../../lib/worker-tasks/protocol";

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const body = await readJsonObject(request);
    const deviceId = readDeviceId(body.device_id);
    const deviceName = readDeviceName(body.device_name);
    const agents = await listEligibleDesktopWorkerAgents(identity);
    await recordHeartbeat({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId,
      deviceName,
      agentIds: agents.map((agent) => agent.id),
    });
    return NextResponse.json({ agents: agents.map(toWorkerAgentCard) });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
