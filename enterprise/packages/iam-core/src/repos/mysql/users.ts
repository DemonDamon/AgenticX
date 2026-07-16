import type { AuthUser } from "@agenticx/auth";
import { hashPassword } from "@agenticx/auth";
import { departments, roles, userRoles, users } from "@agenticx/db-schema/mysql";
import type { MySqlDrizzleDb } from "../../database/mysql";
import type { SQLWrapper } from "drizzle-orm";
import { and, desc, eq, exists, inArray, isNull, like, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";

import type {
  AdminUserDto,
  AdminUserStatus,
  ListUsersFilter,
  UpdateAdminUserInput,
} from "../users";
import type { UsersRepository } from "../contracts";
import { insertMysqlAuditEvent } from "./audit";
import { getMysqlRepositoryDb } from "./db";
import { getMysqlUserRolesDetail, mysqlRolesRepository } from "./roles";

function ilike(col: SQLWrapper, pattern: string) {
  return sql`lower(${col}) like lower(${pattern})`;
}

function mapDbStatus(row: typeof users.$inferSelect): AdminUserStatus {
  const lockedUntil = row.lockedUntil?.getTime() ?? 0;
  if (lockedUntil > Date.now()) return "locked";
  if (row.status === "disabled") return "disabled";
  return row.status === "locked" ? "locked" : "active";
}

async function toDto(row: typeof users.$inferSelect): Promise<AdminUserDto> {
  const { scopes, roleCodes } = await getMysqlUserRolesDetail(row.tenantId, row.id);
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
  const db = await getMysqlRepositoryDb();
  const [self] = await db
    .select({ path: departments.path })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, deptId)))
    .limit(1);
  if (!self) return [];
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), like(departments.path, `${self.path}%`)));
  return rows.map((r) => r.id);
}

function isActiveUserRow(row: typeof users.$inferSelect): boolean {
  return !row.isDeleted && row.deletedAt == null;
}

async function findUserRowByTenantEmail(
  db: MySqlDrizzleDb,
  tenantId: string,
  email: string,
): Promise<typeof users.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
    .limit(1);
  return row ?? null;
}

function buildNewUserFields(input: {
  displayName: string;
  deptId?: string | null;
  status?: AdminUserStatus;
  phone?: string | null;
  employeeNo?: string | null;
  jobTitle?: string | null;
  passwordHash: string;
}): Omit<typeof users.$inferInsert, "id" | "tenantId" | "email" | "createdAt"> & {
  updatedAt: Date;
} {
  const now = new Date();
  const rowStatus: "active" | "disabled" = input.status === "disabled" ? "disabled" : "active";
  return {
    deptId: input.deptId ?? null,
    displayName: input.displayName.trim(),
    passwordHash: input.passwordHash,
    status: rowStatus,
    phone: input.phone ?? null,
    employeeNo: input.employeeNo ?? null,
    jobTitle: input.jobTitle ?? null,
    failedLoginCount: 0,
    lockedUntil: null,
    isDeleted: false,
    deletedAt: null,
    updatedAt: now,
  };
}

async function replaceUserRoles(
  db: MySqlDrizzleDb,
  input: {
    tenantId: string;
    userId: string;
    roleIds: string[];
    defaultOrgId: string | null;
    defaultDeptId: string | null;
  },
): Promise<void> {
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

async function applyUserFilters(
  db: MySqlDrizzleDb,
  tenantId: string,
  filter: ListUsersFilter,
): Promise<ReturnType<typeof and> | undefined> {
  const parts = [
    eq(users.tenantId, tenantId),
    eq(users.isDeleted, false),
    isNull(users.deletedAt),
  ] as const;

  const extra: Parameters<typeof and>[number][] = [];

  if (filter.status) {
    if (filter.status === "locked") {
      extra.push(sql`${users.lockedUntil} is not null and ${users.lockedUntil} > UTC_TIMESTAMP(6)`);
    } else if (filter.status === "disabled") {
      extra.push(eq(users.status, "disabled"));
    } else if (filter.status === "active") {
      extra.push(
        and(
          eq(users.status, "active"),
          or(isNull(users.lockedUntil), sql`${users.lockedUntil} <= UTC_TIMESTAMP(6)`),
        )!,
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
        ilike(sql`coalesce(${users.phone}, '')`, pattern),
      )!,
    );
  }

  if (filter.deptId) {
    if (filter.deptScope === "direct") {
      extra.push(eq(users.deptId, filter.deptId));
    } else {
      const subtree = await listDepartmentSubtreeIdsLocal(tenantId, filter.deptId);
      if (subtree.length) {
        extra.push(inArray(users.deptId, subtree));
      } else {
        extra.push(sql`false`);
      }
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
              eq(roles.code, filter.roleCode),
            ),
          ),
      ),
    );
  }

  return and(...parts, ...extra);
}

async function getAdminUserInternal(tenantId: string, id: string): Promise<AdminUserDto | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.id, id),
        eq(users.isDeleted, false),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toDto(row);
}

export const mysqlUsersRepository: UsersRepository = {
  dialect: "mysql",
  async loadAuthUserByEmail(tenantId, email) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.email, email.toLowerCase()),
          eq(users.isDeleted, false),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { scopes } = await getMysqlUserRolesDetail(tenantId, row.id);
    const lockedUntil = row.lockedUntil?.getTime() ?? null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      deptId: row.deptId,
      email: row.email.toLowerCase(),
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      status: mapDbStatus(row),
      failedLoginCount: row.failedLoginCount ?? 0,
      lockedUntil,
      scopes,
    };
  },
  async updateFailedLogin(tenantId, email, nextFailedCount, lockedUntilMs) {
    const db = await getMysqlRepositoryDb();
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
  },
  async resetFailedLogin(tenantId, email) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select({ status: users.status })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())))
      .limit(1);
    const nextStatus = row?.status === "locked" ? "active" : row?.status ?? "active";
    await db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())));
  },
  async listAdminUsers(tenantId, filter = {}) {
    const db = await getMysqlRepositoryDb();
    const where = await applyUserFilters(db, tenantId, filter);
    const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
    const offset = Math.max(0, filter.offset ?? 0);

    const [totalRow] = await db
      .select({ c: sql<number>`cast(count(*) as signed)` })
      .from(users)
      .where(where);
    const total = totalRow?.c ?? 0;

    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const items = await Promise.all(rows.map((r) => toDto(r)));
    return { items, total };
  },
  getAdminUser: getAdminUserInternal,
  async createAdminUser(input) {
    const db = await getMysqlRepositoryDb();
    const email = input.email.trim().toLowerCase();
    if (!email) throw new Error("email is required");

    const existing = await findUserRowByTenantEmail(db, input.tenantId, email);
    if (existing && isActiveUserRow(existing)) {
      throw new Error("email already exists");
    }

    const initialPassword = input.initialPassword?.trim() || generateInitialPassword();
    const passwordHash = await hashPassword(initialPassword);
    const now = new Date();
    const userFields = buildNewUserFields({
      displayName: input.displayName,
      deptId: input.deptId,
      status: input.status,
      phone: input.phone,
      employeeNo: input.employeeNo,
      jobTitle: input.jobTitle,
      passwordHash,
    });

    let id: string;
    let restored = false;
    if (existing) {
      id = existing.id;
      restored = true;
      await db
        .update(users)
        .set(userFields)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.id, id)));
    } else {
      id = ulid();
      await db.insert(users).values({
        id,
        tenantId: input.tenantId,
        email,
        createdAt: now,
        ...userFields,
      });
    }

    const codes = input.roleCodes?.length ? input.roleCodes : ["member"];
    const idMap = await mysqlRolesRepository.resolveRoleIdsFromCodes(input.tenantId, codes);
    const roleIds = codes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
    if (roleIds.length === 0) {
      const member = await mysqlRolesRepository.getRoleByCode(input.tenantId, "member");
      if (member) roleIds.push(member.id);
    }
    await replaceUserRoles(db, {
      tenantId: input.tenantId,
      userId: id,
      roleIds,
      defaultOrgId: input.defaultOrgId,
      defaultDeptId: input.deptId ?? null,
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: restored ? "iam.user.restore" : "iam.user.create",
      targetKind: "user",
      targetId: id,
      detail: { email, roleCodes: codes, restored },
    });

    const user = await getAdminUserInternal(input.tenantId, id);
    if (!user) throw new Error("user create failed");
    return { user, initialPassword };
  },
  async updateAdminUser(tenantId, id, patch, ctx) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.id, id), eq(users.isDeleted, false), isNull(users.deletedAt)),
      )
      .limit(1);
    if (!row) throw new Error("user not found");

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
      const idMap = await mysqlRolesRepository.resolveRoleIdsFromCodes(tenantId, patch.roleCodes);
      const roleIds = patch.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
      const deptId = patch.deptId !== undefined ? patch.deptId : row.deptId;
      await replaceUserRoles(db, {
        tenantId,
        userId: id,
        roleIds,
        defaultOrgId: ctx.defaultOrgId,
        defaultDeptId: deptId ?? null,
      });
    }

    await insertMysqlAuditEvent({
      tenantId,
      actorUserId: ctx.actorUserId ?? null,
      eventType: "iam.user.update",
      targetKind: "user",
      targetId: id,
      detail: patch as Record<string, unknown>,
    });

    const updated = await getAdminUserInternal(tenantId, id);
    if (!updated) throw new Error("user update failed");
    return updated;
  },
  async softDeleteUser(tenantId, id, actorUserId) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.id, id), eq(users.isDeleted, false), isNull(users.deletedAt)),
      )
      .limit(1);
    const { roleCodes } = await getMysqlUserRolesDetail(tenantId, id);

    const now = new Date();
    await db
      .update(users)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));

    await db.delete(userRoles).where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, id)));

    await insertMysqlAuditEvent({
      tenantId,
      actorUserId: actorUserId ?? null,
      eventType: "iam.user.delete",
      targetKind: "user",
      targetId: id,
      detail: {
        email: row?.email,
        displayName: row?.displayName,
        roleCodes,
      },
    });
  },
  async resetUserPassword(input) {
    const initialPassword = generateInitialPassword();
    const passwordHash = await hashPassword(initialPassword);
    const db = await getMysqlRepositoryDb();
    await db
      .update(users)
      .set({
        passwordHash,
        lockedUntil: null,
        failedLoginCount: 0,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(eq(users.tenantId, input.tenantId), eq(users.id, input.userId), eq(users.isDeleted, false)),
      );

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.user.reset_password",
      targetKind: "user",
      targetId: input.userId,
    });

    return { initialPassword };
  },
  async upsertUserRowFromAuthUser(user) {
    const db = await getMysqlRepositoryDb();
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
      .onDuplicateKeyUpdate({
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
  },
  async assignRolesIfNone(input) {
    const db = await getMysqlRepositoryDb();
    const [existing] = await db
      .select({ r: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, input.tenantId), eq(userRoles.userId, input.userId)))
      .limit(1);
    if (existing) return;
    const idMap = await mysqlRolesRepository.resolveRoleIdsFromCodes(input.tenantId, input.roleCodes);
    const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
    if (!roleIds.length) return;
    await replaceUserRoles(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      roleIds,
      defaultOrgId: input.defaultOrgId,
      defaultDeptId: input.defaultDeptId,
    });
  },
  async upsertUserByEmail(input) {
    const db = await getMysqlRepositoryDb();
    const email = input.email.trim().toLowerCase();
    const existing = await findUserRowByTenantEmail(db, input.tenantId, email);
    const now = new Date();
    let userId: string;

    if (existing && isActiveUserRow(existing)) {
      userId = existing.id;
      await db
        .update(users)
        .set({
          displayName: input.displayName.trim(),
          deptId: input.deptId,
          phone: input.phone ?? null,
          employeeNo: input.employeeNo ?? null,
          jobTitle: input.jobTitle ?? null,
          passwordHash: input.passwordHash,
          status: input.status && input.status !== "locked" ? input.status : existing.status,
          updatedAt: now,
        })
        .where(and(eq(users.tenantId, input.tenantId), eq(users.id, userId)));
    } else if (existing) {
      userId = existing.id;
      await db
        .update(users)
        .set(
          buildNewUserFields({
            displayName: input.displayName,
            deptId: input.deptId,
            status: input.status,
            phone: input.phone,
            employeeNo: input.employeeNo,
            jobTitle: input.jobTitle,
            passwordHash: input.passwordHash,
          }),
        )
        .where(and(eq(users.tenantId, input.tenantId), eq(users.id, userId)));
    } else {
      userId = ulid();
      await db.insert(users).values({
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

    const idMap = await mysqlRolesRepository.resolveRoleIdsFromCodes(input.tenantId, input.roleCodes);
    const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
    await replaceUserRoles(db, {
      tenantId: input.tenantId,
      userId,
      roleIds,
      defaultOrgId: input.defaultOrgId,
      defaultDeptId: input.deptId,
    });

    await insertMysqlAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: "iam.bulk_import.user_upsert",
      targetKind: "user",
      targetId: userId,
      detail: { email },
    });

    const user = await getAdminUserInternal(input.tenantId, userId);
    if (!user) throw new Error("user upsert failed");
    return user;
  },
  async replaceUserRoleAssignments(input) {
    const db = await getMysqlRepositoryDb();
    const idMap = await mysqlRolesRepository.resolveRoleIdsFromCodes(input.tenantId, input.roleCodes);
    const roleIds = input.roleCodes.map((c) => idMap.get(c)).filter((x): x is string => Boolean(x));
    await replaceUserRoles(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      roleIds,
      defaultOrgId: input.defaultOrgId,
      defaultDeptId: input.defaultDeptId,
    });
  },
};
