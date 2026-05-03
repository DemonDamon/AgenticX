import { verifyPassword } from "@agenticx/auth";
import { ensureSystemRoles, getDefaultOrgId, hasSomeScope, loadAuthUserByEmail } from "@agenticx/iam-core";

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

export { getDefaultOrgId };
