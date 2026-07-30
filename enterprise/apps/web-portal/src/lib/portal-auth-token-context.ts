import type { AuthContext, AuthUser } from "@agenticx/auth";

/**
 * Portal tokens carry identity only.  Live scopes are hydrated from the
 * database after cookie verification, which keeps the cookie header bounded
 * even for administrator accounts with many effective permissions.
 */
export function buildPortalTokenContext(user: AuthUser, sessionId: string): AuthContext {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    deptId: user.deptId ?? null,
    email: user.email,
    scopes: [],
    mustChangePassword: user.mustChangePassword,
    sessionId,
  };
}
