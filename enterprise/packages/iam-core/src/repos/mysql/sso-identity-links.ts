import type { AuthUser } from "@agenticx/auth";
import { ssoIdentityLinks, users } from "@agenticx/db-schema/mysql";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SsoIdentityKey, SsoIdentityLinkedUser } from "../sso-identity-links";
import { getUserRolesDetail } from "../roles";
import { getMysqlRepositoryDb } from "./db";

export async function mysqlFindSsoIdentityLink(tenantId: string, key: SsoIdentityKey, hash: string): Promise<SsoIdentityLinkedUser | null> {
  const [row] = await (await getMysqlRepositoryDb()).select({
    userId: ssoIdentityLinks.userId, email: users.email,
    providerId: ssoIdentityLinks.providerId, issuer: ssoIdentityLinks.issuer, subject: ssoIdentityLinks.subject,
  }).from(ssoIdentityLinks).innerJoin(users, and(eq(users.id, ssoIdentityLinks.userId), eq(users.tenantId, ssoIdentityLinks.tenantId)))
    .where(and(eq(ssoIdentityLinks.tenantId, tenantId), eq(ssoIdentityLinks.identityHash, hash))).limit(1);
  if (!row) return null;
  if (row.providerId !== key.providerId || row.issuer !== key.issuer || row.subject !== key.subject) throw new Error("oidc.identity_conflict");
  return { userId: row.userId, email: row.email.toLowerCase() };
}

export async function mysqlBindSsoIdentityLink(tenantId: string, key: SsoIdentityKey, identityHash: string, providerHash: string, userId: string): Promise<void> {
  await (await getMysqlRepositoryDb()).insert(ssoIdentityLinks).values({ tenantId, identityHash, providerHash, ...key, userId })
    .onDuplicateKeyUpdate({ set: { userId: sql`${ssoIdentityLinks.userId}` } });
}

export async function mysqlInsertSsoUserIfAbsent(user: AuthUser): Promise<void> {
  await (await getMysqlRepositoryDb()).insert(users).values({
    id: user.id, tenantId: user.tenantId, deptId: user.deptId ?? null,
    email: user.email.toLowerCase(), displayName: user.displayName, passwordHash: user.passwordHash,
    mustChangePassword: false, status: "active", failedLoginCount: 0, lockedUntil: null,
  }).onDuplicateKeyUpdate({ set: { id: sql`${users.id}` } });
}

export async function mysqlLoadSsoUserById(tenantId: string, userId: string): Promise<AuthUser | null> {
  const [row] = await (await getMysqlRepositoryDb()).select().from(users).where(and(
    eq(users.tenantId, tenantId), eq(users.id, userId), eq(users.isDeleted, false), isNull(users.deletedAt),
  )).limit(1);
  if (!row) return null;
  const { scopes } = await getUserRolesDetail(tenantId, userId);
  return {
    id: row.id, tenantId: row.tenantId, deptId: row.deptId, email: row.email.toLowerCase(),
    displayName: row.displayName, passwordHash: row.passwordHash, mustChangePassword: row.mustChangePassword,
    status: row.status === "disabled" ? "disabled" : row.status === "locked" ? "locked" : "active",
    failedLoginCount: row.failedLoginCount, lockedUntil: row.lockedUntil?.getTime() ?? null, scopes,
  };
}
