import { roles, userRoles, users } from "@agenticx/db-schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { ALL_REGISTERED_SCOPES, mergeUserScopes } from "../scope-registry";
import { getIamDb, type IamDb } from "../db";
import { insertAuditEvent } from "./audit";

export type RoleRow = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  scopes: string[];
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
};

function mapRole(r: typeof roles.$inferSelect, memberCount = 0): RoleRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    name: r.name,
    scopes: (r.scopes as string[]) ?? [],
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
      "audit:read",
      "metering:read",
      "policy:read",
      "model:read",
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
      "audit:read",
      "metering:read",
    ],
  },
  { code: "auditor", name: "审计员", scopes: ["admin:enter", "audit:read", "metering:read"] },
  { code: "member", name: "成员", scopes: ["workspace:chat", "user:read"] },
];

async function memberCounts(tenantId: string): Promise<Map<string, number>> {
  const db = getIamDb();
  const rows = await db
    .select({
      roleId: userRoles.roleId,
      c: sql<number>`count(*)::int`,
    })
    .from(userRoles)
    .where(eq(userRoles.tenantId, tenantId))
    .groupBy(userRoles.roleId);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.roleId, r.c);
  return m;
}

export async function ensureSystemRoles(tenantId: string): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  for (const seed of SYSTEM_ROLE_SEED) {
    await db
      .insert(roles)
      .values({
        id: ulid(),
        tenantId,
        code: seed.code,
        name: seed.name,
        scopes: seed.scopes,
        immutable: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [roles.tenantId, roles.code] });
  }
}

export async function listRoles(tenantId: string): Promise<RoleRow[]> {
  const db = getIamDb();
  const rows = await db.select().from(roles).where(eq(roles.tenantId, tenantId)).orderBy(roles.code);
  const mc = await memberCounts(tenantId);
  return rows.map((r) => mapRole(r, mc.get(r.id) ?? 0));
}

export async function getRoleById(tenantId: string, id: string): Promise<RoleRow | null> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.id, id)))
    .limit(1);
  if (!row[0]) return null;
  const mc = await memberCounts(tenantId);
  return mapRole(row[0], mc.get(row[0].id) ?? 0);
}

export async function getRoleByCode(tenantId: string, code: string): Promise<RoleRow | null> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.code, code)))
    .limit(1);
  if (!row[0]) return null;
  return mapRole(row[0], 0);
}

export async function createCustomRole(input: {
  tenantId: string;
  code: string;
  name: string;
  scopes: string[];
  actorUserId?: string | null;
}): Promise<RoleRow> {
  const db = getIamDb();
  const code = input.code.trim().toLowerCase().replace(/\s+/g, "_");
  if (!code) throw new Error("角色代码不能为空");
  const existed = await getRoleByCode(input.tenantId, code);
  if (existed) throw new Error("角色代码已存在");

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

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.role.create",
    targetKind: "role",
    targetId: id,
    detail: { code, scopes: input.scopes },
  });

  return (await getRoleById(input.tenantId, id))!;
}

export async function updateRole(input: {
  tenantId: string;
  actorUserId?: string | null;
  id: string;
  name?: string;
  scopes?: string[];
}): Promise<RoleRow> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)))
    .limit(1);
  if (!row[0]) throw new Error("角色不存在");
  if (row[0].immutable) throw new Error("系统内置角色不可编辑");

  const now = new Date();
  await db
    .update(roles)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
      updatedAt: now,
    })
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)));

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.role.update",
    targetKind: "role",
    targetId: input.id,
    detail: { name: input.name, scopes: input.scopes },
  });

  return (await getRoleById(input.tenantId, input.id))!;
}

export async function deleteRole(input: {
  tenantId: string;
  id: string;
  actorUserId?: string | null;
}): Promise<void> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)))
    .limit(1);
  if (!row[0]) throw new Error("角色不存在");
  if (row[0].immutable) throw new Error("系统内置角色不可删除");

  const used = await db
    .select({ u: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.tenantId, input.tenantId), eq(userRoles.roleId, input.id)))
    .limit(1);
  if (used[0]) throw new Error("role_in_use");

  await db.delete(roles).where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, input.id)));

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.role.delete",
    targetKind: "role",
    targetId: input.id,
    detail: { code: row[0].code },
  });
}

export async function duplicateRole(input: {
  tenantId: string;
  sourceId: string;
  newCode: string;
  newName: string;
  actorUserId?: string | null;
}): Promise<RoleRow> {
  const source = await getRoleById(input.tenantId, input.sourceId);
  if (!source) throw new Error("源角色不存在");
  return createCustomRole({
    tenantId: input.tenantId,
    code: input.newCode,
    name: input.newName,
    scopes: [...source.scopes],
    actorUserId: input.actorUserId,
  });
}

export async function resolveRoleIdsFromCodes(
  tenantId: string,
  codes: string[],
  dbOrTx?: IamDb
): Promise<Map<string, string>> {
  const db = dbOrTx ?? getIamDb();
  const clean = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await db
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.code, clean)));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.code, r.id);
  return m;
}

export async function listUsersForRole(tenantId: string, roleId: string): Promise<
  Array<{ userId: string; email: string; displayName: string }>
> {
  const db = getIamDb();
  const rows = await db
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
        isNull(users.deletedAt)
      )
    )
    .orderBy(users.email);
  return rows;
}

export async function aggregateScopesForUser(tenantId: string, userId: string): Promise<string[]> {
  const { scopes } = await getUserRolesDetail(tenantId, userId);
  return scopes;
}

/** 单次查询返回用户角色 code 列表与合并后的 scopes（用于 Admin DTO）。 */
export async function getUserRolesDetail(
  tenantId: string,
  userId: string
): Promise<{ scopes: string[]; roleCodes: string[] }> {
  const db = getIamDb();
  const roleRows = await db
    .select({ scopes: roles.scopes, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId)));
  const roleCodes = roleRows.map((r) => r.code);
  const scopes = mergeUserScopes(roleRows.map((r) => (r.scopes as string[]) ?? []));
  return { scopes, roleCodes };
}

export function superAdminScopesFallback(): string[] {
  return [...ALL_REGISTERED_SCOPES];
}
