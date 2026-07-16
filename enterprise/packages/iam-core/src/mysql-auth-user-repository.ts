import type { AuthUser, AuthUserRepository } from "@agenticx/auth";
import { roles, userRoles, users } from "@agenticx/db-schema/mysql";
import { and, eq, isNull } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./repos/mysql/db";
import { mergeUserScopes } from "./scope-registry";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export class MysqlAuthUserRepository implements AuthUserRepository {
  public constructor(private readonly tenantId: string) {}

  public async findByEmail(email: string): Promise<AuthUser | null> {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.tenantId, this.tenantId),
        eq(users.email, email.trim().toLowerCase()),
        eq(users.isDeleted, false),
        isNull(users.deletedAt),
      ))
      .limit(1);
    if (!row) return null;
    const roleRows = await db
      .select({ scopes: roles.scopes })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.tenantId, this.tenantId), eq(userRoles.userId, row.id)));
    const lockedUntil = row.lockedUntil?.getTime() ?? null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      deptId: row.deptId,
      email: row.email.toLowerCase(),
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      status: lockedUntil && lockedUntil > Date.now()
        ? "locked"
        : row.status === "disabled" ? "disabled" : "active",
      failedLoginCount: row.failedLoginCount,
      lockedUntil,
      scopes: mergeUserScopes(roleRows.map((item) => stringArray(item.scopes))),
    };
  }

  public async updateFailedLogin(
    email: string,
    nextFailedCount: number,
    lockedUntil: number | null,
  ): Promise<void> {
    const db = await getMysqlRepositoryDb();
    const until = lockedUntil === null ? null : new Date(lockedUntil);
    await db.update(users).set({
      failedLoginCount: nextFailedCount,
      lockedUntil: until,
      ...(until && until.getTime() > Date.now() ? { status: "locked" } : {}),
      updatedAt: new Date(),
    }).where(and(eq(users.tenantId, this.tenantId), eq(users.email, email.toLowerCase())));
  }

  public async resetFailedLogin(email: string): Promise<void> {
    const db = await getMysqlRepositoryDb();
    await db.update(users).set({
      failedLoginCount: 0,
      lockedUntil: null,
      status: "active",
      updatedAt: new Date(),
    }).where(and(eq(users.tenantId, this.tenantId), eq(users.email, email.toLowerCase())));
  }

  public async upsertUser(user: AuthUser): Promise<void> {
    const db = await getMysqlRepositoryDb();
    const now = new Date();
    await db.insert(users).values({
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
    }).onDuplicateKeyUpdate({
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
}
