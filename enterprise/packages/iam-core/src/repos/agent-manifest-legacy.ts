import { MANIFEST_SCHEMA } from "@agenticx/core-api";

export const LEGACY_CAPABILITY_IDS_KEY = "legacy_capability_ids";
/** 与 repos/agents.ts 的 CAPABILITY_ID_RE 相同（复制一份，避免循环 import）。 */
export const LEGACY_CAPABILITY_ID_RE = /^(mcp|skill):((?:[0-9A-HJKMNP-TV-Z]{26}|[A-Z2-7]{26}))$/;
/** 回填与派生时从 agent.metadata 剥离的键（系统管理键 + 本模块自管键）。 */
const STRIPPED_METADATA_KEYS = ["model", "description", "agentName", LEGACY_CAPABILITY_IDS_KEY] as const;

const TENANT_SKILL_ID_RE = /^(?:[0-9A-HJKMNP-TV-Z]{26}|[A-Z2-7]{26})$/;

export type LegacyAgentFields = {
  model: string;
  systemPrompt: string;
  capabilityIds: readonly string[];
  metadata: Record<string, unknown>;
};

export type TenantSkillVersions = ReadonlyMap<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return false;
    case "object":
      if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
      if (!isRecord(value)) return false;
      return Object.values(value).every((item) => item === undefined || isJsonValue(item));
    default:
      return false;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    return value.filter((item) => isJsonValue(item)).map((item) => sanitizeValue(item));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!isJsonValue(item)) continue;
      next[key] = sanitizeValue(item);
    }
    return next;
  }
  return null;
}

/** 去掉剥离键；值不是 JSON 可序列化（function/undefined/bigint/symbol）的键丢弃。 */
export function sanitizeLegacyMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stripped: readonly string[] = STRIPPED_METADATA_KEYS;
  for (const [key, value] of Object.entries(metadata)) {
    if (stripped.includes(key)) continue;
    if (!isJsonValue(value)) continue;
    out[key] = sanitizeValue(value);
  }
  return out;
}

function dedupeTrim(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * 由 enterprise_agents 现有列构造 version 1 的原始 manifest（尚未经 validateManifest）。
 */
export function buildLegacyManifest(
  agent: LegacyAgentFields,
  skillVersions: TenantSkillVersions,
): Record<string, unknown> {
  const skills: Array<{ source: "tenant"; id: string; version: string }> = [];
  const legacy: string[] = [];
  for (const id of dedupeTrim(agent.capabilityIds)) {
    const match = LEGACY_CAPABILITY_ID_RE.exec(id);
    const version = match?.[1] === "skill" && match[2] ? skillVersions.get(match[2]) : undefined;
    if (match?.[1] === "skill" && match[2] && version !== undefined) {
      skills.push({ source: "tenant", id: match[2], version });
    } else {
      legacy.push(id);
    }
  }
  const metadata = sanitizeLegacyMetadata(agent.metadata);
  if (legacy.length > 0) metadata[LEGACY_CAPABILITY_IDS_KEY] = legacy;
  return {
    schema: MANIFEST_SCHEMA,
    model: agent.model,
    system: agent.systemPrompt,
    tools: [],
    mcp_servers: [],
    skills,
    multiagent: null,
    runtime: { max_tool_rounds: 40, max_session_tokens: null },
    metadata,
  };
}

/**
 * 从规范化 manifest 推导 enterprise_agents.capability_ids 投影。
 */
export function deriveProjectionCapabilityIds(normalized: Record<string, unknown>): string[] {
  const out: string[] = [];
  const skills = Array.isArray(normalized.skills) ? normalized.skills : [];
  for (const skill of skills) {
    if (!isRecord(skill) || skill.source !== "tenant" || typeof skill.id !== "string") continue;
    if (!TENANT_SKILL_ID_RE.test(skill.id)) continue;
    const id = `skill:${skill.id}`;
    if (!out.includes(id)) out.push(id);
  }
  const metadata = isRecord(normalized.metadata) ? normalized.metadata : {};
  const legacy = Array.isArray(metadata[LEGACY_CAPABILITY_IDS_KEY]) ? metadata[LEGACY_CAPABILITY_IDS_KEY] : [];
  for (const raw of legacy) {
    if (typeof raw !== "string" || !LEGACY_CAPABILITY_ID_RE.test(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/**
 * 旧 updateAgent 改了 model/systemPrompt/capabilityIds/metadata 后，由最新版本规范化 manifest 派生新 manifest。
 */
export function deriveManifestFromLegacyEdit(
  base: Record<string, unknown>,
  merged: LegacyAgentFields,
  skillVersions: TenantSkillVersions,
  metadataPatched: boolean,
): Record<string, unknown> {
  const baseSkills = (Array.isArray(base.skills) ? base.skills : []).filter(isRecord);
  const builtinSkills = baseSkills.filter((skill) => skill.source === "builtin");
  const baseTenantById = new Map<string, Record<string, unknown>>();
  for (const skill of baseSkills) {
    if (skill.source === "tenant" && typeof skill.id === "string") baseTenantById.set(skill.id, skill);
  }

  const tenantSkills: Array<Record<string, unknown>> = [];
  const legacy: string[] = [];
  for (const id of dedupeTrim(merged.capabilityIds)) {
    const match = LEGACY_CAPABILITY_ID_RE.exec(id);
    if (!match) {
      legacy.push(id);
      continue;
    }
    const kind = match[1];
    const rowId = match[2] ?? "";
    if (kind === "mcp") {
      legacy.push(id);
      continue;
    }
    if (kind === "skill") {
      const existing = baseTenantById.get(rowId);
      if (existing) {
        tenantSkills.push({
          source: "tenant",
          id: rowId,
          version: "version" in existing ? existing.version : null,
        });
        continue;
      }
      const pinned = skillVersions.get(rowId);
      if (pinned !== undefined) {
        tenantSkills.push({ source: "tenant", id: rowId, version: pinned });
        continue;
      }
    }
    legacy.push(id);
  }

  const metadata: Record<string, unknown> = {
    ...sanitizeLegacyMetadata(isRecord(base.metadata) ? base.metadata : {}),
    ...(metadataPatched ? sanitizeLegacyMetadata(merged.metadata) : {}),
  };
  if (legacy.length > 0) metadata[LEGACY_CAPABILITY_IDS_KEY] = legacy;
  else delete metadata[LEGACY_CAPABILITY_IDS_KEY];

  return {
    schema: base.schema,
    model: merged.model,
    system: merged.systemPrompt,
    tools: base.tools ?? [],
    mcp_servers: base.mcp_servers ?? [],
    skills: [...builtinSkills, ...tenantSkills],
    multiagent: "multiagent" in base ? base.multiagent : null,
    runtime: base.runtime,
    metadata,
  };
}

/** 返回 manifest 中 skills[].source==="tenant" 且 version 为 null/缺失的 id 列表（去重）。 */
export function tenantSkillIdsNeedingVersion(normalized: Record<string, unknown>): string[] {
  const skills = Array.isArray(normalized.skills) ? normalized.skills : [];
  const out: string[] = [];
  for (const skill of skills) {
    if (!isRecord(skill) || skill.source !== "tenant" || typeof skill.id !== "string" || !skill.id) continue;
    const missing = !("version" in skill) || skill.version == null;
    if (missing && !out.includes(skill.id)) out.push(skill.id);
  }
  return out;
}

/**
 * 用 skillVersions 固化 tenant skill 版本；返回 {manifest, errors}。
 */
export type MemberAgentInfo = {
  latestVersion: number;
  /** version -> whether that version's normalized manifest has a non-null multiagent. null = version not found. */
  isCoordinatorAt: (version: number) => Promise<boolean | null>;
};

export function memberAgentIds(normalized: Record<string, unknown>): string[] {
  const multiagent = normalized.multiagent;
  if (!isRecord(multiagent) || !Array.isArray(multiagent.agents)) return [];
  const ids: string[] = [];
  for (const member of multiagent.agents) {
    if (!isRecord(member) || member.type !== "agent" || typeof member.id !== "string" || !member.id) continue;
    if (!ids.includes(member.id)) ids.push(member.id);
  }
  return ids;
}

/**
 * Pin omitted member versions and reject unknown, self, missing, or coordinator members.
 * Database lookups stay on the caller. A null multiagent is returned unchanged.
 */
export async function pinMultiagentMembers(
  normalized: Record<string, unknown>,
  lookup: (agentId: string) => Promise<MemberAgentInfo | null>,
  selfAgentId: string | null,
): Promise<{ manifest: Record<string, unknown>; errors: string[] }> {
  const multiagent = normalized.multiagent;
  if (multiagent == null || !isRecord(multiagent) || !Array.isArray(multiagent.agents)) {
    return { manifest: normalized, errors: [] };
  }
  const errors: string[] = [];
  const agents: unknown[] = [];
  for (let index = 0; index < multiagent.agents.length; index += 1) {
    const member = multiagent.agents[index];
    if (!isRecord(member) || member.type !== "agent") {
      agents.push(member);
      continue;
    }
    const id = typeof member.id === "string" ? member.id : "";
    if (selfAgentId !== null && id === selfAgentId) {
      errors.push(
        `manifest.multiagent.agents[${index}].id: use {"type":"self"} to reference this agent`,
      );
      agents.push(member);
      continue;
    }
    const info = await lookup(id);
    if (info == null) {
      errors.push(`manifest.multiagent.agents[${index}].id: unknown agent "${id}"`);
      agents.push(member);
      continue;
    }
    const version = member.version == null ? info.latestVersion : member.version;
    const pinned = { ...member, version };
    const coordinator = await info.isCoordinatorAt(typeof version === "number" ? version : info.latestVersion);
    if (coordinator == null) {
      errors.push(`manifest.multiagent.agents[${index}].version: agent "${id}" has no version ${version}`);
    } else if (coordinator) {
      errors.push(
        `manifest.multiagent.agents[${index}].id: agent "${id}" is a coordinator; only one level of delegation is allowed`,
      );
    }
    agents.push(pinned);
  }
  return {
    manifest: { ...normalized, multiagent: { ...multiagent, agents } },
    errors,
  };
}

export function pinTenantSkillVersions(
  normalized: Record<string, unknown>,
  skillVersions: TenantSkillVersions,
): { manifest: Record<string, unknown>; errors: string[] } {
  const skills = Array.isArray(normalized.skills) ? normalized.skills : [];
  const errors: string[] = [];
  const nextSkills = skills.map((skill, index) => {
    if (!isRecord(skill) || skill.source !== "tenant") return skill;
    const id = typeof skill.id === "string" ? skill.id : "";
    if (!skillVersions.has(id)) {
      errors.push(`manifest.skills[${index}].id: unknown tenant skill "${id}"`);
      return skill;
    }
    const existing = "version" in skill ? skill.version : undefined;
    if (typeof existing === "string" && existing.length > 0) return skill;
    return { ...skill, version: skillVersions.get(id) };
  });
  return { manifest: { ...normalized, skills: nextSkills }, errors };
}
