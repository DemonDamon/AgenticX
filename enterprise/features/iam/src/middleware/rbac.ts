import type { AuthContext } from "@agenticx/auth";

export class RbacError extends Error {
  public readonly status: number;

  public constructor(message: string, status = 403) {
    super(message);
    this.name = "RbacError";
    this.status = status;
  }
}

export function assertTenantMatch(auth: AuthContext, tenantId: string): void {
  if (auth.tenantId !== tenantId) {
    throw new RbacError("Tenant isolation violation.", 403);
  }
}

export function assertScopes(auth: AuthContext, requiredScopes: string[]): void {
  const missing = requiredScopes.filter((scope) => !auth.scopes.includes(scope));
  if (missing.length > 0) {
    throw new RbacError(`Missing required scopes: ${missing.join(", ")}`, 403);
  }
}

export function assertTenantScope(auth: AuthContext, tenantId: string, requiredScopes: string[]): void {
  assertTenantMatch(auth, tenantId);
  assertScopes(auth, requiredScopes);
}

