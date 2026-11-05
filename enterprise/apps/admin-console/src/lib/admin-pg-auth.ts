import { verifyPassword } from "@agenticx/auth";
import { bindSsoIdentityLink, findSsoIdentityLink, loadSsoAuthUserById, withTenantIamTransaction, aggregateScopesForUser, ensureSystemRoles, getDefaultOrgId, hasSomeScope, loadAuthUserByEmail } from "@agenticx/iam-core";

export async function authenticateAdminConsoleUser(input: {
  email: string;
  password: string;
  tenantId: string;
}): Promise<{ userId: string; tenantId: string; email: string } | null> {
  await ensureSystemRoles(input.tenantId);
  const user = await loadAuthUserByEmail(input.tenantId, input.email.trim().toLowerCase());
  if (!user) return null;
  if (user.status === "disabled") return null;
  if (user.status === "locked") return null;
  if (user.lockedUntil && user.lockedUntil > Date.now()) return null;

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) return null;

  if (!hasSomeScope(user.scopes, ["admin:enter"])) return null;

  return { userId: user.id, tenantId: user.tenantId, email: user.email.toLowerCase() };
}

export async function authenticateAdminConsoleViaOidc(input: {
  email: string;
  tenantId: string;
  protocol: "oidc" | "saml";
  providerId?: string;
  issuer?: string;
  subject?: string | null;
  emailVerified?: boolean | null;
}): Promise<
  | { ok: true; userId: string; tenantId: string; email: string }
  | { ok: false; reason: "admin_unprovisioned" | "admin_scope_missing" | "account_disabled" }
> {
  await ensureSystemRoles(input.tenantId);
  const identityKey = input.protocol === "oidc" ? {
    providerId: input.providerId ?? "", issuer: input.issuer ?? "", subject: input.subject ?? "",
  } : null;
  const authenticate = async (knownLink?: { userId: string; email: string }) => {
    const linked = knownLink ?? (identityKey ? await findSsoIdentityLink(input.tenantId, identityKey) : null);
    if (identityKey && !linked && input.emailVerified !== true) throw new Error("oidc.email_unverified");
    const user = linked
      ? await loadSsoAuthUserById(input.tenantId, linked.userId)
      : await loadAuthUserByEmail(input.tenantId, input.email.trim().toLowerCase());
    if (!user || (linked && user.id !== linked.userId) || user.tenantId !== input.tenantId) {
      return { ok: false as const, reason: "admin_unprovisioned" as const };
    }
    if (user.status === "disabled" || user.status === "locked" || (user.lockedUntil && user.lockedUntil > Date.now())) {
      return { ok: false as const, reason: "account_disabled" as const };
    }
    const scopes = await aggregateScopesForUser(input.tenantId, user.id);
    if (!hasSomeScope(scopes, ["admin:enter"])) return { ok: false as const, reason: "admin_scope_missing" as const };
    if (identityKey && !linked) await bindSsoIdentityLink(input.tenantId, identityKey, user.id);
    return { ok: true as const, userId: user.id, tenantId: user.tenantId, email: user.email.toLowerCase() };
  };
  const existingLink = identityKey ? await findSsoIdentityLink(input.tenantId, identityKey) : null;
  if (existingLink) return authenticate(existingLink);
  return identityKey ? withTenantIamTransaction(input.tenantId, () => authenticate()) : authenticate();
}

export { getDefaultOrgId };
