/**
 * web-portal · 只读：当前用户实际可用的企业能力（Skill / MCP）。
 *
 * 分配范围沿用可见模型那套 key（`all` / `dept:<id>` / 用户 ulid），部门链从直属
 * 取到根 —— 上级分配的包，下级成员同样拿得到。
 *
 * 企业停用的包与能力**不会出现在结果里**，而不是带 disabled 标记下发：下发出去
 * 就等于让撤销依赖客户端守规矩，而桌面端把企业配置连同 token 缓存在本机明文
 * 配置文件里，被撤销的客户端手上握着上次拿到的全部东西。
 */

import {
  groupCapabilityIdsByKind,
  parseCapabilityId,
  resolveEffectiveCapabilities,
  type CapabilityAssignment,
} from "@agenticx/config";
import {
  enterpriseCapabilityAssignments as pgAssignments,
  enterpriseCapabilityOptOuts as pgOptOuts,
  enterpriseCapabilityPackMembers as pgMembers,
  enterpriseCapabilityPacks as pgPacks,
  enterpriseSkills as pgSkills,
  mcpServers as pgMcpServers,
} from "@agenticx/db-schema";
import {
  enterpriseCapabilityAssignments as myAssignments,
  enterpriseCapabilityOptOuts as myOptOuts,
  enterpriseCapabilityPackMembers as myMembers,
  enterpriseCapabilityPacks as myPacks,
  enterpriseSkills as mySkills,
  mcpServers as myMcpServers,
} from "@agenticx/db-schema/mysql";
import {
  createMysqlDb,
  getIamDb,
  listDepartmentAncestorIds,
  resolveDatabaseConfig,
} from "@agenticx/iam-core";
import { and, eq, inArray } from "drizzle-orm";

import { collectUserAssignmentKeys, deptAssignmentKey } from "./effective-models";

/** 分配给全员的固定 key。 */
export const ALL_MEMBERS_ASSIGNMENT_KEY = "all";

export type PortalCapability = {
  /** `mcp:<ulid>` / `skill:<ulid>` */
  id: string;
  kind: "mcp" | "skill";
  name: string;
  displayName: string;
  /** Skill 声明的依赖能力；MCP 恒为空。 */
  requires: string[];
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
};

type SkillRow = {
  id: string;
  slug: string;
  displayName: string | null;
  version: string;
  bundleUri: string | null;
  bundleDigest: string | null;
  requiredCapabilities: unknown;
};
type McpRow = { id: string; name: string; displayName: string | null };

/** 本文件用到的 drizzle 查询构造子集。 */
type DialectQuery = {
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      innerJoin: (table: unknown, on: unknown) => { where: (cond: unknown) => Promise<unknown[]> };
      where: (cond: unknown) => Promise<unknown[]>;
    };
  };
};

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required to resolve enterprise capabilities.");
  return t;
}

async function dialectTables() {
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    return {
      db,
      packs: myPacks,
      assignments: myAssignments,
      members: myMembers,
      optOuts: myOptOuts,
      skills: mySkills,
      mcp: myMcpServers,
    } as const;
  }
  return {
    db: getIamDb(),
    packs: pgPacks,
    assignments: pgAssignments,
    members: pgMembers,
    optOuts: pgOptOuts,
    skills: pgSkills,
    mcp: pgMcpServers,
  } as const;
}

/** 该用户名下所有生效的分配 key：全员 + 部门链 + 用户自身。 */
export async function resolveAssignmentKeysForUser(
  tenantId: string,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<string[]> {
  const keys = new Set<string>([ALL_MEMBERS_ASSIGNMENT_KEY]);
  for (const key of collectUserAssignmentKeys(userId, email)) keys.add(key);
  if (deptId) {
    for (const ancestor of await listDepartmentAncestorIds(tenantId, deptId)) {
      keys.add(deptAssignmentKey(ancestor));
    }
  }
  return [...keys];
}

function toSkillCapability(row: SkillRow): PortalCapability {
  return {
    id: `skill:${row.id}`,
    kind: "skill",
    name: row.slug,
    displayName: row.displayName || row.slug,
    requires: Array.isArray(row.requiredCapabilities)
      ? (row.requiredCapabilities as unknown[]).map(String)
      : [],
    version: row.version,
    bundleUri: row.bundleUri ?? "",
    bundleDigest: row.bundleDigest ?? "",
  };
}

function toMcpCapability(row: McpRow): PortalCapability {
  return {
    id: `mcp:${row.id}`,
    kind: "mcp",
    name: row.name,
    displayName: row.displayName || row.name,
    requires: [],
  };
}

export async function listAvailableCapabilitiesForUser(
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<PortalCapability[]> {
  const tenantId = requiredTenant();
  const t = await dialectTables();
  // PG 与 MySQL 的 drizzle db 类型不同，联合类型会让链式调用无法解析。这里按实际
  // 用到的最小结构收敛一次；表对象本身仍是各自方言的强类型，字段写错照样报错。
  const query = t.db as unknown as DialectQuery;
  const assignmentKeys = await resolveAssignmentKeysForUser(tenantId, userId, email, deptId);

  // 只取 active 的包：停用的包在这一步就消失，不进入后续任何环节。
  const packRows = (await query
    .select({ id: t.packs.id })
    .from(t.packs)
    .innerJoin(t.assignments, eq(t.assignments.packId, t.packs.id))
    .where(
      and(
        eq(t.packs.tenantId, tenantId),
        eq(t.packs.status, "active"),
        inArray(t.assignments.assignmentKey, assignmentKeys),
      ),
    )) as Array<{ id: string }>;
  const packIds = [...new Set(packRows.map((row) => row.id))];
  if (packIds.length === 0) return [];

  const memberRows = (await query
    .select({ capabilityId: t.members.capabilityId })
    .from(t.members)
    .where(inArray(t.members.packId, packIds))) as Array<{ capabilityId: string }>;
  const candidateIds = [...new Set(memberRows.map((row) => row.capabilityId))];
  if (candidateIds.length === 0) return [];

  const grouped = groupCapabilityIdsByKind(candidateIds);

  // 成员行只是引用；被引用的那一行自身也可能已停用，两层都要过。
  const skillRows = grouped.skill.length
    ? ((await query
        .select()
        .from(t.skills)
        .where(
          and(
            eq(t.skills.tenantId, tenantId),
            eq(t.skills.status, "active"),
            inArray(t.skills.id, grouped.skill),
          ),
        )) as SkillRow[])
    : [];
  const mcpRows = grouped.mcp.length
    ? ((await query
        .select()
        .from(t.mcp)
        .where(
          and(
            eq(t.mcp.tenantId, tenantId),
            eq(t.mcp.status, "active"),
            inArray(t.mcp.id, grouped.mcp),
          ),
        )) as McpRow[])
    : [];

  const optOutRows = (await query
    .select({ capabilityId: t.optOuts.capabilityId })
    .from(t.optOuts)
    .where(
      and(eq(t.optOuts.tenantId, tenantId), eq(t.optOuts.userId, userId)),
    )) as Array<{ capabilityId: string }>;
  const optOuts = new Set(optOutRows.map((row) => row.capabilityId));

  const byId = new Map<string, PortalCapability>();
  for (const row of skillRows) byId.set(`skill:${row.id}`, toSkillCapability(row));
  for (const row of mcpRows) byId.set(`mcp:${row.id}`, toMcpCapability(row));

  // 走同一个策略函数，避免这里与管理端对「生效」有两套判断。
  const assignments: CapabilityAssignment[] = candidateIds.map((capabilityId) => ({
    capabilityId,
    enterpriseEnabled: byId.has(capabilityId),
  }));

  return resolveEffectiveCapabilities(assignments, optOuts)
    .map((id) => byId.get(id))
    .filter((item): item is PortalCapability => Boolean(item))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Skill 声明的依赖若没随包下发，Desktop 装了也调不通；标出来供前端提示。 */
export function findUnmetSkillDependencies(capabilities: readonly PortalCapability[]): string[] {
  const present = new Set(capabilities.map((item) => item.id));
  const missing = new Set<string>();
  for (const item of capabilities) {
    for (const dependency of item.requires) {
      if (!parseCapabilityId(dependency)) continue;
      if (!present.has(dependency)) missing.add(dependency);
    }
  }
  return [...missing].sort();
}
