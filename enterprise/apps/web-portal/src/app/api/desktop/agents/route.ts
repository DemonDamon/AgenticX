import { NextResponse } from "next/server";
import {
  listAgentsVisibleToKeys,
  listAgentsWithMa,
  listMaEnvironments,
  resolveAssignmentKeysForUser,
  type EnterpriseAgentWithMa,
  type MaEnvironment,
} from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { toDesktopAgentCard } from "../../../../lib/desktop-agent-catalog";
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
  let maById = new Map<string, EnterpriseAgentWithMa>();
  let envById = new Map<string, MaEnvironment>();
  try {
    const [withMa, envs] = await Promise.all([
      listAgentsWithMa(identity.tenantId),
      listMaEnvironments(identity.tenantId, { status: "active" }),
    ]);
    maById = new Map(withMa.map((item) => [item.id, item]));
    envById = new Map(envs.map((item) => [item.id, item]));
  } catch (error) {
    console.warn("[desktop/agents] managed-agent enrichment unavailable", error);
  }
  return NextResponse.json({
    agents: agents.map((agent) => toDesktopAgentCard(agent, maById.get(agent.id), envById, identity.userId)),
  });
}
