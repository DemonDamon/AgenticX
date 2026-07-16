import { roles, userRoles, users } from "@agenticx/db-schema/mysql";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { ALL_REGISTERED_SCOPES, mergeUserScopes } from "../../scope-registry";
import type { RoleRow } from "../roles";
import type { RolesRepository } from "../contracts";
import { insertMysqlAuditEvent } from "./audit";
import { getMysqlRepositoryDb } from "./db";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function mapRole(r: typeof roles.$inferSelect, memberCount = 0): RoleRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    name: r.name,
    scopes: stringArray(r.scopes),
    immutable: r.immutable,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    memberCount,
  };
}

const SYSTEM_ROLE_SEED: Array<{ code: string; name: string; scopes: string[] }> = [
  { code: "super_admin", name: "超级管理员", scopes: ["*"] },
  {
    code: "owner",
    name: "企业拥有者",
    scopes: [
      "admin:enter",
      "workspace:chat",
      "user:create",
      "user:read",
      "user:update",
      "user:delete",
      "user:manage",
      "dept:create",
      "dept:read",
      "dept:update",
      "dept:delete",
      "dept:manage",
      "role:create",
      "role:read",
      "role:update",
      "role:delete",
      "role:manage",
      "audit:read:all",
      "audit:export",
      "metering:read",
      "policy:read",
      "policy:create",
      "policy:update",
      "policy:delete",
      "policy:publish",
      "policy:disable",
      "policy:manage",
      "model:read",
      "sso:manage",
    ],
  },
  {
    code: "admin",
    name: "管理员",
    scopes: [
      "admin:enter",
      "workspace:chat",
      "user:create",
      "user:read",
      "user:update",
      "dept:read",
      "dept:create",
      "role:read",
      "audit:read:all",
      "audit:export",
      "metering:read",
    ],
  },
  {
    code: "dept_admin",
    name: "部门审计",
    scopes: ["admin:enter", "audit:read:dept", "audit:export", "metering:read", "user:read", "dept:read"],
  },
  {
    code: "auditor",
    name: "审计员",
    scopes: ["admin:enter", "audit:read:all", "audit:export", "metering:read"],
  },
  {
    code: "sso_admin",
    name: "SSO 管理员",
    scopes: ["admin:enter", "sso:read", "sso:create", "sso:update", "sso:delete", "sso:manage"],
  },
  {
    code: "policy_admin",
    name: "策略管理员",
    scopes: [
      "admin:enter",
      "policy:read",
      "policy:create",
      "policy:update",
      "policy:delete",
      "policy:disable",
    ],
  },
  {
    code: "policy_publisher",
    name: "策略发布员",
    scopes: ["admin:enter", "policy:read", "policy:publish"],
  },
  {
    code: "policy_auditor",
    name: "策略审阅员",
    scopes: ["admin:enter", "policy:read"],
  },
  { code: "member", name: "成员", scopes: ["workspace:chat", "user:read"] },
];

async function memberCounts(tenantId: string): Promise<Map<string, number>> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({
      roleId: userRoles.roleId,
      c: sql<number>`cast(count(*) as signed)`,
    })
    .from(userRoles)
    .where(eq(userRoles.tenantId, tenantId))
    .groupBy(userRoles.roleId);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.roleId, r.c);
  return m;
}

async function getRoleByIdInternal(tenantId: string, id: string): Promise<RoleRow | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.id, id)))
    .limit(1);
  if (!row) return null;
  const mc = await memberCounts(tenantId);
  return mapRole(row, mc.get(row.id) ?? 0);
}

export async function getMysqlUserRolesDetail(
  tenantId: string,
  userId: string,
): Promise<{ scopes: string[]; roleCodes: string[] }> {
  const db = await getMysqlRepositoryDb();
  const roleRows = await db
    .select({ scopes: roles.scopes, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId)));
  const roleCodes = roleRows.map((r) => r.code);
  const scopes = mergeUserScopes(roleRows.map((r) => stringArray(r.scopes)));
  return { scopes, roleCodes };
}

export const mysqlRolesRepository: RolesRepository = {
  dialect: "mysql",
  async ensureSystemRoles(tenantId) {
    const db = await getMysqlRepositoryDb();
    const now = new Date();
    for (const seed of SYSTEM_ROLE_SEED) {
      const [existing] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.code, seed.code)))
        .limit(1);
      if (existing) continue;
      await db.insert(roles).values({
        id: ulid(),
        tenantId,
        code: seed.code,
        name: seed.name,
        scopes: seed.scopes,
        immutable: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
  async listRoles(tenantId) {
    const db = await getMysqlRepositoryDb();
    const rows = await db.select().from(roles).where(eq(roles.tenantId, tenantId)).orderBy(roles.code);
    const mc = await memberCounts(tenantId);
    return rows.map((r) => mapRole(r, mc.get(r.id) ?? 0));
  },
  getRoleById: getRoleByIdInternal,
  async getRoleByCode(tenantId, code) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.code, code)))
      .limit(1);
    return row ? mapRole(row, 0) : null;
  },
  async createCustomRole(input) {
    const code = input.code.trim().toLowerCase().replace(/\s+/g, "_");
    if (!code) throw new Error("角色代码不能为空");
    const existed = await mysqlRolesRepository.getRoleByCode(input.tenantId, code);
    if (existed) throw new Error("角色代码已存在");

    const db = await getMysqlRepositoryDb();
    const id = ulid();
    const now = new Date();
    await db.insert(roles).values({
      id,
      tenantId: input.tenantId,
      code,
      name: input.name.trim(),
      scopes: input.scopes,
      immutable: false,
      createdAt: now,
      updatedAt: now,
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.role.create",
      targetKind: "role",
      targetId: id,
      detail: { code, scopes: input.scopes },
    });

    const created = await getRoleByIdInternal(input.tenantId, id);
    if (!created) throw new Error("role create failed");
    return created;
  },
  async updateRole(input) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)))
      .limit(1);
    if (!row) throw new Error("角色不存在");
    if (row.immutable) throw new Error("系统内置角色不可编辑");

    const now = new Date();
    await db
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        updatedAt: now,
      })
      .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)));

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.role.update",
      targetKind: "role",
      targetId: input.id,
      detail: { name: input.name, scopes: input.scopes },
    });

    const updated = await getRoleByIdInternal(input.tenantId, input.id);
    if (!updated) throw new Error("role update failed");
    return updated;
  },
  async deleteRole(input) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)))
      .limit(1);
    if (!row) throw new Error("角色不存在");
    if (row.immutable) throw new Error("系统内置角色不可删除");

    const [used] = await db
      .select({ u: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, input.tenantId), eq(userRoles.roleId, input.id)))
      .limit(1);
    if (used) throw new Error("role_in_use");

    await db.delete(roles).where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)));

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.role.delete",
      targetKind: "role",
      targetId: input.id,
      detail: { code: row.code },
    });
  },
  async duplicateRole(input) {
    const source = await getRoleByIdInternal(input.tenantId, input.sourceId);
    if (!source) throw new Error("源角色不存在");
    return mysqlRolesRepository.createCustomRole({
      tenantId: input.tenantId,
      code: input.newCode,
      name: input.newName,
      scopes: [...source.scopes],
      actorUserId: input.actorUserId,
    });
  },
  async resolveRoleIdsFromCodes(tenantId, codes) {
    const db = await getMysqlRepositoryDb();
    const clean = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    if (!clean.length) return new Map();
    const rows = await db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), inArray(roles.code, clean)));
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.code, r.id);
    return m;
  },
  async listUsersForRole(tenantId, roleId) {
    const db = await getMysqlRepositoryDb();
    return db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(userRoles)
      .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.tenantId, userRoles.tenantId)))
      .where(
        and(
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.roleId, roleId),
          eq(users.isDeleted, false),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.email);
  },
  getUserRolesDetail: getMysqlUserRolesDetail,
};

export function superAdminScopesFallback(): string[] {
  return [...ALL_REGISTERED_SCOPES];
}
