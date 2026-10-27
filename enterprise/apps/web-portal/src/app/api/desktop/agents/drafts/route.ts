import { NextResponse } from "next/server";
import { listAgentsWithMa, type EnterpriseAgentWithMa } from "@agenticx/iam-core";

import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import { workerUnauthorized } from "../../../../../lib/worker-tasks/protocol";

export const dynamic = "force-dynamic";

function updatedAtIso(value: EnterpriseAgentWithMa["updatedAt"] | Date): string {
  if (typeof value === "object" && value instanceof Date) return value.toISOString();
  return String(value);
}

function toDraftSummary(agent: EnterpriseAgentWithMa) {
  return {
    agent_id: agent.id,
    display_name: agent.displayName,
    description: agent.description,
    local_avatar_id: agent.localAvatarId,
    lifecycle: agent.lifecycle,
    latest_version: agent.latestVersion,
    effective_version: agent.effectiveVersion,
    routing_mode: agent.versionRouting,
    updated_at: updatedAtIso(agent.updatedAt),
  };
}

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const agents = await listAgentsWithMa(identity.tenantId);
  const mine = agents
    .filter(
      (agent) =>
        agent.origin === "employee" && agent.ownerUserId === identity.userId && Boolean(agent.localAvatarId),
    )
    .map(toDraftSummary)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return NextResponse.json({ agents: mine });
}
