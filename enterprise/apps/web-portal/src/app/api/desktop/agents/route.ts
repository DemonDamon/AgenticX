import { NextResponse } from "next/server";
import { listAgentsVisibleToKeys, resolveAssignmentKeysForUser } from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { workerUnauthorized } from "../../../../lib/worker-tasks/protocol";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const keys = await resolveAssignmentKeysForUser(
    identity.tenantId,
    identity.userId,
    identity.email,
    identity.deptId,
  );
  const agents = await listAgentsVisibleToKeys(identity.tenantId, keys);
  return NextResponse.json({
    agents: agents.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      displayName: agent.displayName,
      description: agent.description,
      runtime: agent.runtime,
      model: agent.model,
      origin: agent.origin,
      systemPrompt: agent.systemPrompt,
    })),
  });
}
