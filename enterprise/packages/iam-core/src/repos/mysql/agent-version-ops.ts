import {
  enterpriseAgents as mysqlAgents,
  enterpriseAgentVersions as mysqlVersions,
  enterpriseSkills as mysqlSkills,
  maEnvironments as mysqlEnvironments,
} from "@agenticx/db-schema/mysql";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { MySqlDrizzleDb } from "../../database/mysql";
import type { AgentVersionOps, AgentVersionRowLike, LockedAgentRow } from "../agent-version-ops";

type MySqlLikeDb = Pick<MySqlDrizzleDb, "select" | "insert" | "update">;

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

export function createMysqlAgentVersionOps(db: MySqlLikeDb): AgentVersionOps {
  return {
    async lockAgent(tenantId, agentId) {
      const rows = await db
        .select()
        .from(mysqlAgents)
        .where(and(eq(mysqlAgents.tenantId, tenantId), eq(mysqlAgents.id, agentId)))
        .for("update")
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const locked: LockedAgentRow = {
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
      return locked;
    },
    async maxVersion(agentId) {
      const rows = await db
        .select({ v: sql<number>`coalesce(max(${mysqlVersions.version}), 0)` })
        .from(mysqlVersions)
        .where(eq(mysqlVersions.agentId, agentId));
      return Number(rows[0]?.v ?? 0) || 0;
    },
    async insertVersion(row) {
      await db.insert(mysqlVersions).values({
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
        .update(mysqlAgents)
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
        .where(and(eq(mysqlAgents.tenantId, tenantId), eq(mysqlAgents.id, agentId)));
    },
    async setMaSettings(tenantId, agentId, patch, now) {
      await db
        .update(mysqlAgents)
        .set({ ...patch, updatedAt: now } as Partial<typeof mysqlAgents.$inferInsert>)
        .where(and(eq(mysqlAgents.tenantId, tenantId), eq(mysqlAgents.id, agentId)));
    },
    async updateAgentColumns(tenantId, agentId, set) {
      await db
        .update(mysqlAgents)
        .set(set as Partial<typeof mysqlAgents.$inferInsert>)
        .where(and(eq(mysqlAgents.tenantId, tenantId), eq(mysqlAgents.id, agentId)));
    },
    async findVersion(tenantId, agentId, version) {
      const rows = await db
        .select()
        .from(mysqlVersions)
        .where(
          and(
            eq(mysqlVersions.tenantId, tenantId),
            eq(mysqlVersions.agentId, agentId),
            eq(mysqlVersions.version, version),
          ),
        )
        .limit(1);
      return rows[0] ? mapVersion(rows[0]) : null;
    },
    async findAgentsLatestVersions(tenantId, ids) {
      const map = new Map<string, number>();
      if (ids.length === 0) return map;
      const rows = await db
        .select({ id: mysqlAgents.id, latestVersion: mysqlAgents.latestVersion })
        .from(mysqlAgents)
        .where(and(eq(mysqlAgents.tenantId, tenantId), inArray(mysqlAgents.id, [...ids])));
      for (const row of rows) map.set(row.id, row.latestVersion);
      return map;
    },
    async listVersions(tenantId, agentId, opts) {
      const where = opts.beforeVersion == null
        ? and(eq(mysqlVersions.tenantId, tenantId), eq(mysqlVersions.agentId, agentId))
        : and(
            eq(mysqlVersions.tenantId, tenantId),
            eq(mysqlVersions.agentId, agentId),
            lt(mysqlVersions.version, opts.beforeVersion),
          );
      const rows = await db
        .select()
        .from(mysqlVersions)
        .where(where)
        .orderBy(desc(mysqlVersions.version))
        .limit(opts.limit);
      return rows.map(mapVersion);
    },
    async findTenantSkillVersions(tenantId, ids) {
      const map = new Map<string, string>();
      if (ids.length === 0) return map;
      const rows = await db
        .select({ id: mysqlSkills.id, version: mysqlSkills.version })
        .from(mysqlSkills)
        .where(and(eq(mysqlSkills.tenantId, tenantId), inArray(mysqlSkills.id, [...ids])));
      for (const row of rows) map.set(row.id, row.version);
      return map;
    },
    async findEnvironment(tenantId, envId) {
      const rows = await db
        .select({ id: mysqlEnvironments.id, type: mysqlEnvironments.type, status: mysqlEnvironments.status })
        .from(mysqlEnvironments)
        .where(and(eq(mysqlEnvironments.tenantId, tenantId), eq(mysqlEnvironments.id, envId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertAgent(row) {
      await db.insert(mysqlAgents).values(row as typeof mysqlAgents.$inferInsert);
    },
  };
}
