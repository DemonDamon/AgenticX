import { hashPassword, verifyPassword } from "@agenticx/auth";
import {
  loadAuthUserByEmail,
  updatePasswordAndClearRequirementPg,
} from "./repos/users";

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
}): Promise<void> {
  const tenantId = input.tenantId.trim();
  const email = input.email.trim().toLowerCase();
  if (!tenantId || !email) return;

  const user = await loadAuthUserByEmail(tenantId, email);
  if (!user) return;

  if (await verifyPassword(input.password, user.passwordHash)) return;

  await updatePasswordAndClearRequirementPg(
    tenantId,
    email,
    await hashPassword(input.password),
  );
}
