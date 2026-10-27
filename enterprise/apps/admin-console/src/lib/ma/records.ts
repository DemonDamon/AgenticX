import type { AgentRecord, AgentVersionRecord, EnvironmentRecord } from "@agenticx/core-api";
import type { AgentVersion, EnterpriseAgentWithMa, MaEnvironment } from "@agenticx/iam-core";

/** 别名 MA-00 `AgentRecord`。映射函数始终输出全部 12 个冻结键。 */
export type MaAgentRecord = AgentRecord;
/** 别名 MA-00 `AgentVersionRecord`。映射函数始终输出全部 7 个冻结键。 */
export type MaAgentVersionRecord = AgentVersionRecord;
/** 别名 MA-00 `EnvironmentRecord`（不含 description）。 */
export type MaEnvironmentRecord = EnvironmentRecord;

export type MaAgentRouting = {
  mode: "follow_latest" | "pinned";
  pinned_version: number | null;
  effective_version: number;
};

export function toMaAgentRecord(agent: EnterpriseAgentWithMa): MaAgentRecord {
  return {
    id: agent.id,
    tenant_id: agent.tenantId,
    slug: agent.slug,
    display_name: agent.displayName,
    description: agent.description,
    latest_version: agent.latestVersion,
    status: agent.status,
    lifecycle: agent.lifecycle,
    origin: agent.origin,
    assignment_keys: agent.assignmentKeys,
    worker_keys: agent.workerKeys,
    default_environment_id: agent.defaultEnvironmentId,
  };
}

export function toMaAgentRouting(agent: EnterpriseAgentWithMa): MaAgentRouting {
  return {
    mode: agent.versionRouting,
    pinned_version: agent.pinnedVersion,
    effective_version: agent.effectiveVersion,
  };
}

export function toMaAgentVersionRecord(version: AgentVersion): MaAgentVersionRecord {
  return {
    agent_id: version.agentId,
    version: version.version,
    manifest: version.manifest,
    manifest_hash: version.manifestHash,
    created_by: version.createdBy,
    created_at: version.createdAt,
    note: version.note,
  };
}

export function toMaEnvironmentRecord(env: MaEnvironment): MaEnvironmentRecord {
  return {
    id: env.id,
    tenant_id: env.tenantId,
    name: env.name,
    type: env.type,
    config: env.config,
    status: env.status,
  };
}

/** {agent, routing} 包装。公共接口 GET 单个与列表元素都用它。 */
export function toMaAgentEnvelope(agent: EnterpriseAgentWithMa): { agent: MaAgentRecord; routing: MaAgentRouting } {
  return { agent: toMaAgentRecord(agent), routing: toMaAgentRouting(agent) };
}
