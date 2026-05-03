import type { AuthUser } from "@agenticx/auth";
import { hashPassword } from "@agenticx/auth";
import { departments, roles, userRoles, users } from "@agenticx/db-schema";
import { and, desc, eq, exists, inArray, ilike, isNull, like, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { getIamDb, type IamDb } from "../db";
import { insertAuditEvent } from "./audit";
import { getRoleByCode, getUserRolesDetail, resolveRoleIdsFromCodes } from "./roles";

export type AdminUserStatus = "active" | "disabled" | "locked";

export type AdminUserDto = {
  id: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  scopes: string[];
  /** 当前绑定的系统/自定义角色 code，便于管理端编辑回显。 */
  roleCodes: string[];
  phone: string | null;
  employeeNo: string | null;
  jobTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListUsersFilter = {
  q?: string;
  status?: AdminUserStatus;
  deptId?: string;
  roleCode?: string;
  limit?: number;
  offset?: number;
};

export type ListUsersResult = { items: AdminUserDto[]; total: number };

function mapDbStatus(row: typeof users.$inferSelect): AdminUserStatus {
  const lockedUntil = row.lockedUntil?.getTime() ?? 0;
  if (lockedUntil > Date.now()) return "locked";
  if (row.status === "disabled") return "disabled";
  return row.status === "locked" ? "locked" : "active";
}

async function toDto(row: typeof users.$inferSelect): Promise<AdminUserDto> {
  const { scopes, roleCodes } = await getUserRolesDetail(row.tenantId, row.id);
  return {
    id: row.id,
    tenantId: row.tenantId,
    deptId: row.deptId,
    email: row.email,
    displayName: row.displayName,
    status: mapDbStatus(row),
    scopes,
    roleCodes,
    phone: row.phone ?? null,
    employeeNo: row.employeeNo ?? null,
    jobTitle: row.jobTitle ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function generateInitialPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  const buf = randomBytes(12);
  for (let i = 0; i < 12; i++) out += chars[buf[i]! % chars.length];
  return out;
}

async function listDepartmentSubtreeIdsLocal(tenantId: string, deptId: string): Promise<string[]> {
  const db = getIamDb();
  const self = await db
    .select({ path: departments.path })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, deptId)))
    .limit(1);
  if (!self[0]) return [];
  const base = self[0].path;
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), like(departments.path, `${base}%`)));
  return rows.map((r) => r.id);
}

export async function loadAuthUserByEmail(tenantId: string, email: string): Promise<AuthUser | null> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.email, email.toLowerCase()),
        eq(users.isDeleted, false),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  if (!row[0]) return null;
  const { scopes } = await getUserRolesDetail(tenantId, row[0].id);
  const lockedUntil = row[0].lockedUntil?.getTime() ?? null;
  return {
    id: row[0].id,
    tenantId: row[0].tenantId,
    deptId: row[0].deptId,
    email: row[0].email.toLowerCase(),
    displayName: row[0].displayName,
    passwordHash: row[0].passwordHash,
    status: mapDbStatus(row[0]),
    failedLoginCount: row[0].failedLoginCount ?? 0,
    lockedUntil,
    scopes,
  };
}

export async function updateFailedLoginPg(
  tenantId: string,
  email: string,
  nextFailedCount: number,
  lockedUntilMs: number | null
): Promise<void> {
  const db = getIamDb();
  const lu = lockedUntilMs === null ? null : new Date(lockedUntilMs);
  const locking = Boolean(lu && lu.getTime() > Date.now());
  await db
    .update(users)
    .set({
      failedLoginCount: nextFailedCount,
      lockedUntil: lu,
      ...(locking ? { status: "locked" as const } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())));
}

export async function resetFailedLoginPg(tenantId: string, email: string): Promise<void> {
  const db = getIamDb();
  const row = await db
    .select({ status: users.status })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())))
    .limit(1);
  const nextStatus = row[0]?.status === "locked" ? "active" : row[0]?.status ?? "active";
  await db
    .update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())));
}

async function applyUserFilters(
  tenantId: string,
  filter: ListUsersFilter
): Promise<ReturnType<typeof and> | undefined> {
  const db = getIamDb();
  const parts = [
    eq(users.tenantId, tenantId),
    eq(users.isDeleted, false),
    isNull(users.deletedAt),
  ] as const;

  const extra: Parameters<typeof and>[number][] = [];

  if (filter.status) {
    if (filter.status === "locked") {
      extra.push(sql`${users.lockedUntil} is not null and ${users.lockedUntil} > now()`);
    } else if (filter.status === "disabled") {
      extra.push(eq(users.status, "disabled"));
    } else if (filter.status === "active") {
      extra.push(
        and(eq(users.status, "active"), or(isNull(users.lockedUntil), sql`${users.lockedUntil} <= now()`)!)!
      );
    }
  }

  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    extra.push(
      or(
        ilike(users.email, pattern),
        ilike(users.displayName, pattern),
        ilike(sql`coalesce(${users.employeeNo}, '')`, pattern),
        ilike(sql`coalesce(${users.phone}, '')`, pattern)
      )!
    );
  }

  if (filter.deptId) {
    const subtree = await listDepartmentSubtreeIdsLocal(tenantId, filter.deptId);
    if (subtree.length) {
      extra.push(inArray(users.deptId, subtree));
    } else {
      extra.push(sql`false`);
    }
  }

  if (filter.roleCode) {
    extra.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(userRoles.userId, users.id),
              eq(userRoles.tenantId, tenantId),
              eq(roles.code, filter.roleCode)
            )
          )
      )
    );
  }

  return and(...parts, ...extra);
}

export async function listAdminUsers(tenantId: string, filter: ListUsersFilter = {}): Promise<ListUsersResult> {
  const db = getIamDb();
  const where = await applyUserFilters(tenantId, filter);
  const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const totalRow = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(where);
  const total = totalRow[0]?.c ?? 0;

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const items = await Promise.all(rows.map((r) => toDto(r)));
  return { items, total };
}

export async function getAdminUser(tenantId: string, id: string): Promise<AdminUserDto | null> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.id, id),
        eq(users.isDeleted, false),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  if (!row[0]) return null;
  return toDto(row[0]);
}

async function replaceUserRoles(
  input: {
    tenantId: string;
    userId: string;
    roleIds: string[];
    defaultOrgId: string | null;
    defaultDeptId: string | null;
  },
  dbOrTx: IamDb = getIamDb()
): Promise<void> {
  const db = dbOrTx;
  await db.delete(userRoles).where(and(eq(userRoles.tenantId, input.tenantId), eq(userRoles.userId, input.userId)));
  const now = new Date();
  for (const roleId of input.roleIds) {
    await db.insert(userRoles).values({
      tenantId: input.tenantId,
      userId: input.userId,
      roleId,
      scopeOrgId: input.defaultOrgId,
      scopeDeptId: input.defaultDeptId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function createAdminUser(input: {
  tenantId: string;
  email: string;
  displayName: string;
  deptId?: string | null;
  status?: AdminUserStatus;
  phone?: string | null;
  employeeNo?: string | null;
  jobTitle?: string | null;
  roleCodes?: string[];
  initialPassword?: string | null;
  defaultOrgId: string | null;
  actorUserId?: string | null;
}): Promise<{ user: AdminUserDto; initialPassword: string }> {
  const db = getIamDb();
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("email is required");

  const dup = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, input.tenantId),
        eq(users.email, email),
        eq(users.isDeleted, false),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  if (dup[0]) throw new Error("email already exists");

  const initialPassword = input.initialPassword?.trim() || generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);
  const id = ulid();
  const now = new Date();
  const rowStatus: "active" | "disabled" = input.status === "disabled" ? "disabled" : "active";

  await db.insert(users).values({
    id,
    tenantId: input.tenantId,
    deptId: input.deptId ?? null,
    email,
    displayName: input.displayName.trim(),
    passwordHash,
    status: rowStatus,
    phone: input.phone ?? null,
    employeeNo: input.employeeNo ?? null,
    jobTitle: input.jobTitle ?? null,
    failedLoginCount: 0,
    lockedUntil: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const codes = input.roleCodes?.length ? input.roleCodes : ["member"];
  const idMap = await resolveRoleIdsFromCodes(input.tenantId, codes);
  const roleIds = codes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
  if (roleIds.length === 0) {
    const member = await getRoleByCode(input.tenantId, "member");
    if (member) roleIds.push(member.id);
  }
  await replaceUserRoles({
    tenantId: input.tenantId,
    userId: id,
    roleIds,
    defaultOrgId: input.defaultOrgId,
    defaultDeptId: input.deptId ?? null,
  });

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.user.create",
    targetKind: "user",
    targetId: id,
    detail: { email, roleCodes: codes },
  });

  const user = await getAdminUser(input.tenantId, id);
  return { user: user!, initialPassword };
}

export type UpdateAdminUserInput = {
  displayName?: string;
  deptId?: string | null;
  status?: AdminUserStatus;
  phone?: string | null;
  employeeNo?: string | null;
  jobTitle?: string | null;
  roleCodes?: string[];
};

export async function updateAdminUser(
  tenantId: string,
  id: string,
  patch: UpdateAdminUserInput,
  ctx: { actorUserId?: string | null; defaultOrgId: string | null }
): Promise<AdminUserDto> {
  const db = getIamDb();
  const row = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, id), eq(users.isDeleted, false), isNull(users.deletedAt)))
    .limit(1);
  if (!row[0]) throw new Error("user not found");

  const now = new Date();
  const next: Partial<typeof users.$inferInsert> = { updatedAt: now };
  if (patch.displayName !== undefined) next.displayName = patch.displayName.trim();
  if (patch.deptId !== undefined) next.deptId = patch.deptId;
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.employeeNo !== undefined) next.employeeNo = patch.employeeNo;
  if (patch.jobTitle !== undefined) next.jobTitle = patch.jobTitle;
  if (patch.status !== undefined) {
    next.status = patch.status === "locked" ? "locked" : patch.status;
    if (patch.status === "active") {
      next.lockedUntil = null;
      next.failedLoginCount = 0;
    }
    if (patch.status !== "locked") {
      next.lockedUntil = null;
    }
  }

  await db.update(users).set(next).where(and(eq(users.tenantId, tenantId), eq(users.id, id)));

  if (patch.roleCodes) {
    const idMap = await resolveRoleIdsFromCodes(tenantId, patch.roleCodes);
    const roleIds = patch.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
    const deptId = patch.deptId !== undefined ? patch.deptId : row[0].deptId;
    await replaceUserRoles({
      tenantId,
      userId: id,
      roleIds,
      defaultOrgId: ctx.defaultOrgId,
      defaultDeptId: deptId ?? null,
    });
  }

  await insertAuditEvent({
    tenantId,
    actorUserId: ctx.actorUserId ?? null,
    eventType: "iam.user.update",
    targetKind: "user",
    targetId: id,
    detail: patch as Record<string, unknown>,
  });

  return (await getAdminUser(tenantId, id))!;
}

export async function softDeleteUser(
  tenantId: string,
  id: string,
  actorUserId?: string | null
): Promise<void> {
  const db = getIamDb();
  const row = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, id), eq(users.isDeleted, false), isNull(users.deletedAt)))
    .limit(1);
  const { roleCodes } = await getUserRolesDetail(tenantId, id);

  const now = new Date();
  await db
    .update(users)
    .set({ isDeleted: true, deletedAt: now, updatedAt: now })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));

  await db.delete(userRoles).where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, id)));

  await insertAuditEvent({
    tenantId,
    actorUserId: actorUserId ?? null,
    eventType: "iam.user.delete",
    targetKind: "user",
    targetId: id,
    detail: {
      email: row[0]?.email,
      displayName: row[0]?.displayName,
      roleCodes,
    },
  });
}

export async function resetUserPassword(input: {
  tenantId: string;
  userId: string;
  actorUserId?: string | null;
}): Promise<{ initialPassword: string }> {
  const initialPassword = generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);
  const db = getIamDb();
  await db
    .update(users)
    .set({
      passwordHash,
      lockedUntil: null,
      failedLoginCount: 0,
      status: "active",
      updatedAt: new Date(),
    })
    .where(and(eq(users.tenantId, input.tenantId), eq(users.id, input.userId), eq(users.isDeleted, false)));

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "iam.user.reset_password",
    targetKind: "user",
    targetId: input.userId,
  });

  return { initialPassword };
}

/**
 * Upsert 用户行（portal 同步 / dev bootstrap）；不自动分配角色（由调用方处理）。
 */
export async function upsertUserRowFromAuthUser(user: AuthUser): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: user.id,
      tenantId: user.tenantId,
      deptId: user.deptId ?? null,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      status: user.status === "locked" ? "active" : user.status,
      failedLoginCount: user.failedLoginCount ?? 0,
      lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email.toLowerCase(),
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        deptId: user.deptId ?? null,
        status: user.status === "locked" ? "active" : user.status,
        failedLoginCount: user.failedLoginCount ?? 0,
        lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null,
        isDeleted: false,
        deletedAt: null,
        updatedAt: now,
      },
    });
}

export async function assignRolesIfNone(input: {
  tenantId: string;
  userId: string;
  roleCodes: string[];
  defaultOrgId: string | null;
  defaultDeptId: string | null;
}): Promise<void> {
  const db = getIamDb();
  const existing = await db
    .select({ r: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.tenantId, input.tenantId), eq(userRoles.userId, input.userId)))
    .limit(1);
  if (existing[0]) return;
  const idMap = await resolveRoleIdsFromCodes(input.tenantId, input.roleCodes);
  const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
  if (!roleIds.length) return;
  await replaceUserRoles({
    tenantId: input.tenantId,
    userId: input.userId,
    roleIds,
    defaultOrgId: input.defaultOrgId,
    defaultDeptId: input.defaultDeptId,
  });
}

/** 批量导入等场景：在既有事务内 upsert，与部门路径创建共用同一事务 */
export async function upsertUserByEmailInTx(
  tx: IamDb,
  input: {
    tenantId: string;
    email: string;
    displayName: string;
    deptId: string | null;
    phone?: string | null;
    employeeNo?: string | null;
    jobTitle?: string | null;
    passwordHash: string;
    status?: AdminUserStatus;
    roleCodes: string[];
    defaultOrgId: string | null;
    actorUserId?: string | null;
  }
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const existing = await tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, input.tenantId),
        eq(users.email, email),
        eq(users.isDeleted, false),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  const now = new Date();
  let userId: string;

  if (existing[0]) {
    userId = existing[0].id;
    await tx
      .update(users)
      .set({
        displayName: input.displayName.trim(),
        deptId: input.deptId,
        phone: input.phone ?? null,
        employeeNo: input.employeeNo ?? null,
        jobTitle: input.jobTitle ?? null,
        passwordHash: input.passwordHash,
        status: input.status && input.status !== "locked" ? input.status : existing[0].status,
        updatedAt: now,
      })
      .where(and(eq(users.tenantId, input.tenantId), eq(users.id, userId)));
  } else {
    userId = ulid();
    await tx.insert(users).values({
      id: userId,
      tenantId: input.tenantId,
      deptId: input.deptId,
      email,
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
      status: input.status && input.status !== "locked" ? input.status! : "active",
      phone: input.phone ?? null,
      employeeNo: input.employeeNo ?? null,
      jobTitle: input.jobTitle ?? null,
      failedLoginCount: 0,
      lockedUntil: null,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const idMap = await resolveRoleIdsFromCodes(input.tenantId, input.roleCodes, tx);
  const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
  await replaceUserRoles(
    {
      tenantId: input.tenantId,
      userId,
      roleIds,
      defaultOrgId: input.defaultOrgId,
      defaultDeptId: input.deptId,
    },
    tx
  );

  await insertAuditEvent(
    {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.bulk_import.user_upsert",
      targetKind: "user",
      targetId: userId,
      detail: { email },
    },
    tx
  );

  return userId;
}

/** 批量导入：按 email 幂等 upsert（存在则更新基础字段与密码可选） */
export async function upsertUserByEmail(input: {
  tenantId: string;
  email: string;
  displayName: string;
  deptId: string | null;
  phone?: string | null;
  employeeNo?: string | null;
  jobTitle?: string | null;
  passwordHash: string;
  status?: AdminUserStatus;
  roleCodes: string[];
  defaultOrgId: string | null;
  actorUserId?: string | null;
}): Promise<AdminUserDto> {
  const db = getIamDb();
  let userId = "";
  await db.transaction(async (tx) => {
    userId = await upsertUserByEmailInTx(tx, input);
  });
  return (await getAdminUser(input.tenantId, userId))!;
}

export async function replaceUserRoleAssignments(input: {
  tenantId: string;
  userId: string;
  roleCodes: string[];
  defaultOrgId: string | null;
  defaultDeptId: string | null;
}): Promise<void> {
  const idMap = await resolveRoleIdsFromCodes(input.tenantId, input.roleCodes);
  const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
  await replaceUserRoles({
    tenantId: input.tenantId,
    userId: input.userId,
    roleIds,
    defaultOrgId: input.defaultOrgId,
    defaultDeptId: input.defaultDeptId,
  });
}
