import { listAgents, resolveAssignmentKeysForUser, type EnterpriseAgent } from "@agenticx/iam-core";

export async function listEligibleDesktopWorkerAgents(identity: {
  tenantId: string;
  userId: string;
  email: string;
  deptId: string | null;
}): Promise<EnterpriseAgent[]> {
  const keys = await resolveAssignmentKeysForUser(
    identity.tenantId,
    identity.userId,
    identity.email,
    identity.deptId,
  );
  const wanted = new Set(keys.map((key) => key.trim()).filter(Boolean));
  const agents = await listAgents(identity.tenantId, { status: "active" });
  return agents.filter(
    (agent) => agent.runtime === "desktop_worker" && agent.workerKeys.some((key) => wanted.has(key.trim())),
  );
}

export function toWorkerAgentCard(agent: EnterpriseAgent): {
  id: string;
  slug: string;
  displayName: string;
  systemPrompt: string;
  model: string;
} {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
  };
}
