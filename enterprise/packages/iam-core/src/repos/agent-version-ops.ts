import {
  enterpriseAgents as pgAgents,
  enterpriseAgentVersions as pgVersions,
  enterpriseSkills as pgSkills,
  maEnvironments as pgEnvironments,
} from "@agenticx/db-schema";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb, type IamDb } from "../db";
import { createMysqlAgentVersionOps } from "./mysql/agent-version-ops";
import { getMysqlRepositoryDb } from "./mysql/db";

export type LockedAgentRow = {
  id: string;
  tenantId: string;
  model: string;
  systemPrompt: string;
  capabilityIds: string[];
  metadata: Record<string, unknown>;
  runtime: string;
  latestVersion: number;
  versionRouting: string;
  pinnedVersion: number | null;
  defaultEnvironmentId: string | null;
};

export type AgentVersionRowLike = {
  id: string;
  tenantId: string;
  agentId: string;
  version: number;
  manifest: Record<string, unknown>;
  manifestHash: string;
  note: string | null;
  source: string;
  createdBy: string | null;
  createdAt: string;
};

export type AgentProjection = { model: string; systemPrompt: string; capabilityIds: string[] };

export interface AgentVersionOps {
  /** SELECT ... FROM enterprise_agents WHERE tenant_id=? AND id=? FOR UPDATE；不存在返回 null。 */
  lockAgent(tenantId: string, agentId: string): Promise<LockedAgentRow | null>;
  /** 无版本行返回 0。 */
  maxVersion(agentId: string): Promise<number>;
  insertVersion(row: AgentVersionRowLike): Promise<void>;
  /** 更新 latest_version、updated_at；projection 非 null 时同时写 model/system_prompt/capability_ids。 */
  setLatestVersion(
    tenantId: string,
    agentId: string,
    latestVersion: number,
    projection: AgentProjection | null,
    now: Date,
  ): Promise<void>;
  /** 更新路由/默认环境列（见 updateAgentMaSettings）。 */
  setMaSettings(
    tenantId: string,
    agentId: string,
    patch: { defaultEnvironmentId?: string | null; versionRouting?: string; pinnedVersion?: number | null },
    now: Date,
  ): Promise<void>;
  /** 旧 updateAgent 的 set（与 normalizeForWrite 返回字段一致 + updatedAt）。 */
  updateAgentColumns(tenantId: string, agentId: string, set: Record<string, unknown>): Promise<void>;
  findVersion(tenantId: string, agentId: string, version: number): Promise<AgentVersionRowLike | null>;
  /** Same-tenant enterprise_agents.id ∈ ids → latest_version. Empty ids return an empty Map. */
  findAgentsLatestVersions(tenantId: string, ids: readonly string[]): Promise<Map<string, number>>;
  /** version 倒序；beforeVersion 给定时只取 version < beforeVersion。 */
  listVersions(
    tenantId: string,
    agentId: string,
    opts: { limit: number; beforeVersion?: number },
  ): Promise<AgentVersionRowLike[]>;
  /** 同租户 enterprise_skills 中 id ∈ ids 的 {id → version}（不过滤 status）。ids 为空直接返回空 Map。 */
  findTenantSkillVersions(tenantId: string, ids: readonly string[]): Promise<Map<string, string>>;
  /** 环境存在性（updateAgentMaSettings 用）。 */
  findEnvironment(tenantId: string, envId: string): Promise<{ id: string; type: string; status: string } | null>;
  /** createAgentWithInitialVersion 用：插入 enterprise_agents 一行。 */
  insertAgent(row: Record<string, unknown>): Promise<void>;
}

export type MemoryAgentVersionState = {
  agents: LockedAgentRow[];
  versions: AgentVersionRowLike[];
  skills: Array<{ tenantId: string; id: string; version: string }>;
  environments: Array<{ tenantId: string; id: string; type: string; status: string }>;
};

type PgLikeDb = Pick<IamDb, "select" | "insert" | "update">;

const memoryStates = new WeakMap<AgentVersionOps, MemoryAgentVersionState>();
let testOps: AgentVersionOps | null = null;

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    try {
      return asStringArray(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asMetadata(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapVersion(row: {
  id: string;
  tenantId: string;
  agentId: string;
  version: number;
  manifest: unknown;
  manifestHash: string;
  note: string | null;
  source: string;
  createdBy: string | null;
  createdAt: unknown;
}): AgentVersionRowLike {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    version: Number(row.version),
    manifest: asMetadata(row.manifest),
    manifestHash: row.manifestHash,
    note: row.note,
    source: row.source,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

/** db 可以是 getIamDb() 或其 transaction 回调里的 tx。 */
export function createPgAgentVersionOps(db: PgLikeDb): AgentVersionOps {
  return {
    async lockAgent(tenantId, agentId) {
      const rows = await db
        .select()
        .from(pgAgents)
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, agentId)))
        .for("update")
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        model: row.model,
        systemPrompt: row.systemPrompt,
        capabilityIds: asStringArray(row.capabilityIds),
        metadata: asMetadata(row.metadata),
        runtime: row.runtime,
        latestVersion: Number(row.latestVersion ?? 1) || 1,
        versionRouting: row.versionRouting ?? "follow_latest",
        pinnedVersion: row.pinnedVersion == null ? null : Number(row.pinnedVersion),
        defaultEnvironmentId: row.defaultEnvironmentId ?? null,
      };
    },
    async maxVersion(agentId) {
      const rows = await db
        .select({ v: sql<number>`coalesce(max(${pgVersions.version}), 0)` })
        .from(pgVersions)
        .where(eq(pgVersions.agentId, agentId));
      return Number(rows[0]?.v ?? 0) || 0;
    },
    async insertVersion(row) {
      await db.insert(pgVersions).values({
        id: row.id,
        tenantId: row.tenantId,
        agentId: row.agentId,
        version: row.version,
        manifest: row.manifest,
        manifestHash: row.manifestHash,
        note: row.note,
        source: row.source,
        createdBy: row.createdBy,
        createdAt: new Date(row.createdAt),
      });
    },
    async setLatestVersion(tenantId, agentId, latestVersion, projection, now) {
      await db
        .update(pgAgents)
        .set({
          latestVersion,
          updatedAt: now,
          ...(projection
            ? {
                model: projection.model,
                systemPrompt: projection.systemPrompt,
                capabilityIds: projection.capabilityIds,
              }
            : {}),
        })
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, agentId)));
    },
    async setMaSettings(tenantId, agentId, patch, now) {
      await db
        .update(pgAgents)
        .set({ ...patch, updatedAt: now } as Partial<typeof pgAgents.$inferInsert>)
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, agentId)));
    },
    async updateAgentColumns(tenantId, agentId, set) {
      await db
        .update(pgAgents)
        .set(set as Partial<typeof pgAgents.$inferInsert>)
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, agentId)));
    },
    async findVersion(tenantId, agentId, version) {
      const rows = await db
        .select()
        .from(pgVersions)
        .where(
          and(eq(pgVersions.tenantId, tenantId), eq(pgVersions.agentId, agentId), eq(pgVersions.version, version)),
        )
        .limit(1);
      return rows[0] ? mapVersion(rows[0]) : null;
    },
    async findAgentsLatestVersions(tenantId, ids) {
      const map = new Map<string, number>();
      if (ids.length === 0) return map;
      const rows = await db
        .select({ id: pgAgents.id, latestVersion: pgAgents.latestVersion })
        .from(pgAgents)
        .where(and(eq(pgAgents.tenantId, tenantId), inArray(pgAgents.id, [...ids])));
      for (const row of rows) map.set(row.id, row.latestVersion);
      return map;
    },
    async listVersions(tenantId, agentId, opts) {
      const where =
        opts.beforeVersion == null
          ? and(eq(pgVersions.tenantId, tenantId), eq(pgVersions.agentId, agentId))
          : and(
              eq(pgVersions.tenantId, tenantId),
              eq(pgVersions.agentId, agentId),
              lt(pgVersions.version, opts.beforeVersion),
            );
      const rows = await db
        .select()
        .from(pgVersions)
        .where(where)
        .orderBy(desc(pgVersions.version))
        .limit(opts.limit);
      return rows.map(mapVersion);
    },
    async findTenantSkillVersions(tenantId, ids) {
      const map = new Map<string, string>();
      if (ids.length === 0) return map;
      const rows = await db
        .select({ id: pgSkills.id, version: pgSkills.version })
        .from(pgSkills)
        .where(and(eq(pgSkills.tenantId, tenantId), inArray(pgSkills.id, [...ids])));
      for (const row of rows) map.set(row.id, row.version);
      return map;
    },
    async findEnvironment(tenantId, envId) {
      const rows = await db
        .select({ id: pgEnvironments.id, type: pgEnvironments.type, status: pgEnvironments.status })
        .from(pgEnvironments)
        .where(and(eq(pgEnvironments.tenantId, tenantId), eq(pgEnvironments.id, envId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertAgent(row) {
      await db.insert(pgAgents).values(row as typeof pgAgents.$inferInsert);
    },
  };
}

function cloneState(state: MemoryAgentVersionState): MemoryAgentVersionState {
  return structuredClone(state);
}

function restoreState(state: MemoryAgentVersionState, snapshot: MemoryAgentVersionState): void {
  state.agents.splice(0, state.agents.length, ...snapshot.agents);
  state.versions.splice(0, state.versions.length, ...snapshot.versions);
  state.skills.splice(0, state.skills.length, ...snapshot.skills);
  state.environments.splice(0, state.environments.length, ...snapshot.environments);
}

/** 测试注入：给定后 withAgentVersionOps / withAgentVersionOpsNoTx 不再访问数据库，直接用该 ops。 */
export function __setAgentVersionOpsForTests(ops: AgentVersionOps | null): void {
  testOps = ops;
}

/** 测试模式下返回内存中的 Agent 行；未注入或不是内存 ops 时返回 null。 */
export function peekTestAgents(tenantId: string): LockedAgentRow[] | null {
  if (!testOps) return null;
  const state = memoryStates.get(testOps);
  if (!state) return null;
  return state.agents.filter((agent) => agent.tenantId === tenantId);
}

/** 事务入口。 */
export async function withAgentVersionOps<T>(fn: (ops: AgentVersionOps) => Promise<T>): Promise<T> {
  if (testOps) {
    const state = memoryStates.get(testOps);
    if (!state) return fn(testOps);
    const snapshot = cloneState(state);
    try {
      return await fn(testOps);
    } catch (error) {
      restoreState(state, snapshot);
      throw error;
    }
  }
  if (isMysql()) {
    const db = await getMysqlRepositoryDb();
    return db.transaction(async (tx) => fn(createMysqlAgentVersionOps(tx)));
  }
  return getIamDb().transaction(async (tx) => fn(createPgAgentVersionOps(tx as unknown as PgLikeDb)));
}

/** 非事务入口（只读 / 预览用）。 */
export async function withAgentVersionOpsNoTx<T>(fn: (ops: AgentVersionOps) => Promise<T>): Promise<T> {
  if (testOps) return fn(testOps);
  if (isMysql()) return fn(createMysqlAgentVersionOps(await getMysqlRepositoryDb()));
  return fn(createPgAgentVersionOps(getIamDb()));
}

/** 测试用内存实现：agents / versions / skills / environments 四个数组；lockAgent 不做真实锁。 */
export function createMemoryAgentVersionOps(state: MemoryAgentVersionState): AgentVersionOps {
  const ops: AgentVersionOps = {
    async lockAgent(tenantId, agentId) {
      return state.agents.find((agent) => agent.tenantId === tenantId && agent.id === agentId) ?? null;
    },
    async maxVersion(agentId) {
      return state.versions.filter((row) => row.agentId === agentId).reduce((max, row) => Math.max(max, row.version), 0);
    },
    async insertVersion(row) {
      if (state.versions.some((item) => item.agentId === row.agentId && item.version === row.version)) {
        throw new Error('duplicate key value violates unique constraint "enterprise_agent_versions_agent_version_uq"');
      }
      state.versions.push({ ...row, manifest: { ...row.manifest } });
    },
    async setLatestVersion(tenantId, agentId, latestVersion, projection) {
      const agent = state.agents.find((item) => item.tenantId === tenantId && item.id === agentId);
      if (!agent) return;
      agent.latestVersion = latestVersion;
      if (projection) {
        agent.model = projection.model;
        agent.systemPrompt = projection.systemPrompt;
        agent.capabilityIds = [...projection.capabilityIds];
      }
    },
    async setMaSettings(tenantId, agentId, patch) {
      const agent = state.agents.find((item) => item.tenantId === tenantId && item.id === agentId);
      if (!agent) return;
      if (patch.defaultEnvironmentId !== undefined) agent.defaultEnvironmentId = patch.defaultEnvironmentId;
      if (patch.versionRouting !== undefined) agent.versionRouting = patch.versionRouting;
      if (patch.pinnedVersion !== undefined) agent.pinnedVersion = patch.pinnedVersion;
    },
    async updateAgentColumns(tenantId, agentId, set) {
      const agent = state.agents.find((item) => item.tenantId === tenantId && item.id === agentId);
      if (!agent) return;
      if (typeof set.model === "string") agent.model = set.model;
      if (typeof set.systemPrompt === "string") agent.systemPrompt = set.systemPrompt;
      if (Array.isArray(set.capabilityIds)) agent.capabilityIds = set.capabilityIds.map((item) => String(item));
      if (set.metadata && typeof set.metadata === "object" && !Array.isArray(set.metadata)) {
        agent.metadata = { ...(set.metadata as Record<string, unknown>) };
      }
      if (typeof set.runtime === "string") agent.runtime = set.runtime;
    },
    async findVersion(tenantId, agentId, version) {
      return (
        state.versions.find((row) => row.tenantId === tenantId && row.agentId === agentId && row.version === version) ??
        null
      );
    },
    async findAgentsLatestVersions(tenantId, ids) {
      const map = new Map<string, number>();
      if (ids.length === 0) return map;
      const wanted = new Set(ids);
      for (const agent of state.agents) {
        if (agent.tenantId === tenantId && wanted.has(agent.id)) map.set(agent.id, agent.latestVersion);
      }
      return map;
    },
    async listVersions(tenantId, agentId, opts) {
      return state.versions
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.agentId === agentId &&
            (opts.beforeVersion == null || row.version < opts.beforeVersion),
        )
        .sort((a, b) => b.version - a.version)
        .slice(0, opts.limit);
    },
    async findTenantSkillVersions(tenantId, ids) {
      const wanted = new Set(ids);
      const map = new Map<string, string>();
      if (wanted.size === 0) return map;
      for (const skill of state.skills) {
        if (skill.tenantId === tenantId && wanted.has(skill.id)) map.set(skill.id, skill.version);
      }
      return map;
    },
    async findEnvironment(tenantId, envId) {
      const env = state.environments.find((item) => item.tenantId === tenantId && item.id === envId);
      return env ? { id: env.id, type: env.type, status: env.status } : null;
    },
    async insertAgent(row) {
      state.agents.push({
        id: String(row.id),
        tenantId: String(row.tenantId),
        model: String(row.model ?? ""),
        systemPrompt: String(row.systemPrompt ?? ""),
        capabilityIds: Array.isArray(row.capabilityIds) ? row.capabilityIds.map((item) => String(item)) : [],
        metadata:
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? { ...(row.metadata as Record<string, unknown>) }
            : {},
        runtime: String(row.runtime ?? "cloud"),
        latestVersion: Number(row.latestVersion ?? 1) || 1,
        versionRouting: String(row.versionRouting ?? "follow_latest"),
        pinnedVersion: row.pinnedVersion == null ? null : Number(row.pinnedVersion),
        defaultEnvironmentId: row.defaultEnvironmentId == null ? null : String(row.defaultEnvironmentId),
      });
    },
  };
  memoryStates.set(ops, state);
  return ops;
}
