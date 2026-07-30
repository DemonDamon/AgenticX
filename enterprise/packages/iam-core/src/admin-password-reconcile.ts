import { hashPassword, verifyPassword, type AuthUser } from "@agenticx/auth";
import {
  loadAuthUserByEmail,
  upsertUserRowFromAuthUser,
} from "./repos/users";

export type ReconcileUserPasswordHashByEmailResult = {
  found: boolean;
  updated: boolean;
  user: AuthUser | null;
};

/**
 * Align a configured administrator password with the persisted account only
 * when the caller has already matched that configured credential.  This keeps
 * deployment-time credential rotation from leaving the seed administrator
 * unable to sign in, while avoiding a database write on normal logins.
 */
export async function reconcileUserPasswordHashByEmail(input: {
  tenantId: string;
  email: string;
  password: string;
}): Promise<ReconcileUserPasswordHashByEmailResult> {
  const tenantId = input.tenantId.trim();
  const email = input.email.trim().toLowerCase();
  if (!tenantId || !email) {
    return { found: false, updated: false, user: null };
  }

  const user = await loadAuthUserByEmail(tenantId, email);
  if (!user) {
    return { found: false, updated: false, user: null };
  }

  if (await verifyPassword(input.password, user.passwordHash)) {
    return { found: true, updated: false, user };
  }

  const nextUser: AuthUser = {
    ...user,
    email,
    passwordHash: await hashPassword(input.password),
    failedLoginCount: 0,
    lockedUntil: null,
    status: "active",
  };
  await upsertUserRowFromAuthUser(nextUser);
  return { found: true, updated: true, user: nextUser };
}
