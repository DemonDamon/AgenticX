import { validateManifest } from "@agenticx/core-api";
import { ulid } from "ulid";

import {
  buildLegacyManifest,
  deriveManifestFromLegacyEdit,
  LEGACY_CAPABILITY_ID_RE,
  memberAgentIds,
  pinMultiagentMembers,
  pinTenantSkillVersions,
  type LegacyAgentFields,
} from "./agent-manifest-legacy";
import type { AgentVersionOps, AgentVersionRowLike, LockedAgentRow } from "./agent-version-ops";

export type AgentVersionSource = "backfill" | "admin" | "api" | "legacy_edit" | "desktop";

export type AgentVersion = {
  id: string;
  tenantId: string;
  agentId: string;
  version: number;
  manifest: Record<string, unknown>;
  manifestHash: string;
  note: string | null;
  source: AgentVersionSource;
  createdBy: string | null;
  createdAt: string;
};

export class AgentManifestInvalidError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super("定义校验未通过");
    this.name = "AgentManifestInvalidError";
    this.errors = errors;
  }
}

export class AgentVersionConflictError extends Error {
  readonly currentLatestVersion: number;
  constructor(current: number) {
    super("版本已被他人更新，请刷新后重试");
    this.name = "AgentVersionConflictError";
    this.currentLatestVersion = current;
  }
}

export class AgentVersionNotFoundError extends Error {
  constructor(message = "版本不存在") {
    super(message);
    this.name = "AgentVersionNotFoundError";
  }
}

export type EnsureVersionOneResult =
  | { status: "exists" }
  | { status: "created"; version: AgentVersion }
  | { status: "invalid"; errors: string[] };

const VERSION_SOURCES = ["backfill", "admin", "api", "legacy_edit", "desktop"] as const;

function isAgentVersionSource(value: string): value is AgentVersionSource {
  return (VERSION_SOURCES as readonly string[]).includes(value);
}

export function toAgentVersion(row: AgentVersionRowLike): AgentVersion {
  const source: AgentVersionSource = isAgentVersionSource(row.source) ? row.source : "admin";
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    version: row.version,
    manifest: row.manifest,
    manifestHash: row.manifestHash,
    note: row.note,
    source,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function skillRowIdsOf(capabilityIds: readonly string[]): string[] {
  const ids: string[] = [];
  for (const raw of capabilityIds) {
    const match = LEGACY_CAPABILITY_ID_RE.exec(String(raw ?? "").trim());
    if (match?.[1] === "skill" && match[2] && !ids.includes(match[2])) ids.push(match[2]);
  }
  return ids;
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (
      typeof coded.message === "string" &&
      /duplicate key|ER_DUP_ENTRY|enterprise_agent_versions_agent_version_uq/i.test(coded.message)
    ) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function tenantSkillIds(normalized: Record<string, unknown>): string[] {
  const skills = Array.isArray(normalized.skills) ? normalized.skills : [];
  const ids: string[] = [];
  for (const skill of skills) {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) continue;
    const record = skill as Record<string, unknown>;
    if (record.source === "tenant" && typeof record.id === "string" && record.id && !ids.includes(record.id)) {
      ids.push(record.id);
    }
  }
  return ids;
}

/** 调用前须已在同一事务内 ops.lockAgent。 */
export async function ensureAgentVersionOneInTx(
  ops: AgentVersionOps,
  agent: LockedAgentRow,
): Promise<EnsureVersionOneResult> {
  if ((await ops.maxVersion(agent.id)) > 0) return { status: "exists" };
  const raw = buildLegacyManifest(
    agent,
    await ops.findTenantSkillVersions(agent.tenantId, skillRowIdsOf(agent.capabilityIds)),
  );
  const validated = validateManifest(raw);
  if (!validated.ok || !validated.normalized || !validated.manifestHash) {
    console.warn("ma.agent_version.backfill_invalid", { agentId: agent.id, errors: validated.errors });
    return { status: "invalid", errors: validated.errors };
  }
  const now = new Date();
  const row: AgentVersionRowLike = {
    id: ulid(),
    tenantId: agent.tenantId,
    agentId: agent.id,
    version: 1,
    manifest: validated.normalized,
    manifestHash: validated.manifestHash,
    note: "由现有配置自动生成",
    source: "backfill",
    createdBy: null,
    createdAt: now.toISOString(),
  };
  try {
    await ops.insertVersion(row);
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "exists" };
    throw error;
  }
  await ops.setLatestVersion(agent.tenantId, agent.id, 1, null, now);
  return { status: "created", version: toAgentVersion(row) };
}

/** validateManifest → 固化 tenant skill 版本 → 固化成员版本 → 再 validateManifest。 */
export async function prepareManifestWithOps(
  ops: AgentVersionOps,
  tenantId: string,
  manifest: unknown,
  opts?: { selfAgentId?: string | null },
): Promise<{ ok: true; normalized: Record<string, unknown>; manifestHash: string } | { ok: false; errors: string[] }> {
  const first = validateManifest(manifest);
  if (!first.ok || !first.normalized) return { ok: false, errors: first.errors };
  const pinned = pinTenantSkillVersions(
    first.normalized,
    await ops.findTenantSkillVersions(tenantId, tenantSkillIds(first.normalized)),
  );
  const ids = memberAgentIds(pinned.manifest);
  const latest = await ops.findAgentsLatestVersions(tenantId, ids);
  const members = await pinMultiagentMembers(
    pinned.manifest,
    async (id) => {
      const lv = latest.get(id);
      if (lv === undefined) return null;
      return {
        latestVersion: lv,
        isCoordinatorAt: async (version) => {
          const row = await ops.findVersion(tenantId, id, version);
          if (!row) return null;
          const multiagent = row.manifest.multiagent;
          return multiagent !== null && multiagent !== undefined;
        },
      };
    },
    opts?.selfAgentId ?? null,
  );
  const errors = [...pinned.errors, ...members.errors];
  if (errors.length > 0) return { ok: false, errors: errors.sort() };
  const second = validateManifest(members.manifest);
  if (!second.ok || !second.normalized || !second.manifestHash) return { ok: false, errors: second.errors };
  return { ok: true, normalized: second.normalized, manifestHash: second.manifestHash };
}

/**
 * 旧 updateAgent 改了 manifest 相关字段时调用。
 * 返回 "not_found" | "updated" | "versioned"。
 */
export async function updateAgentWithLegacyVersion(
  ops: AgentVersionOps,
  tenantId: string,
  agentId: string,
  set: Record<string, unknown>,
  merged: LegacyAgentFields,
  metadataPatched: boolean,
): Promise<"not_found" | "updated" | "versioned"> {
  const agent = await ops.lockAgent(tenantId, agentId);
  if (!agent) return "not_found";
  await ops.updateAgentColumns(tenantId, agentId, set);
  const max = await ops.maxVersion(agentId);
  if (max === 0) return "updated";
  const latest = await ops.findVersion(tenantId, agentId, max);
  if (!latest) return "updated";
  const raw = deriveManifestFromLegacyEdit(
    latest.manifest,
    merged,
    await ops.findTenantSkillVersions(tenantId, skillRowIdsOf(merged.capabilityIds)),
    metadataPatched,
  );
  const validated = validateManifest(raw);
  if (!validated.ok || !validated.normalized || !validated.manifestHash) {
    console.warn("ma.agent_version.legacy_sync_skipped", { agentId, errors: validated.errors });
    return "updated";
  }
  if (validated.manifestHash === latest.manifestHash) return "updated";
  const now = new Date();
  await ops.insertVersion({
    id: ulid(),
    tenantId,
    agentId,
    version: max + 1,
    manifest: validated.normalized,
    manifestHash: validated.manifestHash,
    note: "由基础信息编辑同步",
    source: "legacy_edit",
    createdBy: null,
    createdAt: now.toISOString(),
  });
  await ops.setLatestVersion(tenantId, agentId, max + 1, null, now);
  return "versioned";
}
