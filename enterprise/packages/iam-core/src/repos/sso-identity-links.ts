import type { AuthUser } from "@agenticx/auth";
import { createHash } from "node:crypto";
import { ssoIdentityLinks, users } from "@agenticx/db-schema";
import { and, eq, isNull } from "drizzle-orm";
import { resolveDatabaseConfig } from "../database/config";
import { withTenantIamTransaction } from "../database/tenant-iam-transaction";
import { getUserRolesDetail } from "./roles";
import { getIamDb } from "../db";
import { mysqlBindSsoIdentityLink, mysqlFindSsoIdentityLink, mysqlInsertSsoUserIfAbsent, mysqlLoadSsoUserById } from "./mysql/sso-identity-links";

export type SsoIdentityKey = { providerId: string; issuer: string; subject: string };
export type SsoIdentityLinkedUser = { userId: string; email: string };

export function ssoIdentityHash(key: SsoIdentityKey): string {
  for (const [name, limit] of [["providerId", 64], ["issuer", 512], ["subject", 255]] as const) {
    const value = key[name];
    if (!value || value !== value.trim() || value.length > limit) throw new Error("oidc.invalid_identity");
  }
  // A fixed-width index avoids the multi-column utf8mb4 index-size ceiling.
  return createHash("sha256").update(JSON.stringify([key.providerId, key.issuer, key.subject])).digest("hex");
}

/** Includes deleted users: a bound identity must never fall back to a replacement email account. */
export async function findSsoIdentityLink(tenantId: string, key: SsoIdentityKey): Promise<SsoIdentityLinkedUser | null> {
  const hash = ssoIdentityHash(key);
  if (resolveDatabaseConfig().dialect === "mysql") return mysqlFindSsoIdentityLink(tenantId, key, hash);
  const [row] = await getIamDb().select({
    userId: ssoIdentityLinks.userId, email: users.email,
    providerId: ssoIdentityLinks.providerId, issuer: ssoIdentityLinks.issuer, subject: ssoIdentityLinks.subject,
  }).from(ssoIdentityLinks).innerJoin(users, and(eq(users.id, ssoIdentityLinks.userId), eq(users.tenantId, ssoIdentityLinks.tenantId)))
    .where(and(eq(ssoIdentityLinks.tenantId, tenantId), eq(ssoIdentityLinks.identityHash, hash))).limit(1);
  if (!row) return null;
  if (row.providerId !== key.providerId || row.issuer !== key.issuer || row.subject !== key.subject) throw new Error("oidc.identity_conflict");
  return { userId: row.userId, email: row.email.toLowerCase() };
}

/** Insert-only, then verify the authoritative row. Conflicts never change ownership. */
export async function bindSsoIdentityLink(tenantId: string, key: SsoIdentityKey, userId: string): Promise<void> {
  const identityHash = ssoIdentityHash(key);
  const providerHash = createHash("sha256").update(key.providerId).digest("hex");
  await withTenantIamTransaction(tenantId, async () => {
    if (resolveDatabaseConfig().dialect === "mysql") {
      await mysqlBindSsoIdentityLink(tenantId, key, identityHash, providerHash, userId);
    } else {
      await getIamDb().insert(ssoIdentityLinks).values({ tenantId, identityHash, providerHash, ...key, userId }).onConflictDoNothing();
    }
    const confirmed = await findSsoIdentityLink(tenantId, key);
    if (confirmed?.userId !== userId) throw new Error("oidc.identity_conflict");
  });
}

/** JIT is insert-only: an email conflict must never reset an existing account. */
export async function insertSsoUserIfAbsent(user: AuthUser): Promise<void> {
  if (resolveDatabaseConfig().dialect === "mysql") return mysqlInsertSsoUserIfAbsent(user);
  await getIamDb().insert(users).values({
    id: user.id, tenantId: user.tenantId, deptId: user.deptId ?? null,
    email: user.email.toLowerCase(), displayName: user.displayName, passwordHash: user.passwordHash,
    mustChangePassword: false, status: "active", failedLoginCount: 0, lockedUntil: null,
  }).onConflictDoNothing();
}

/** Re-read the linked account by its immutable ID, excluding tombstones. */
export async function loadSsoAuthUserById(tenantId: string, userId: string): Promise<AuthUser | null> {
  if (resolveDatabaseConfig().dialect === "mysql") return mysqlLoadSsoUserById(tenantId, userId);
  const [row] = await getIamDb().select().from(users).where(and(
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
