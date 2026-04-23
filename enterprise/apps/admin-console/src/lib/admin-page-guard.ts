import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./admin-session";

export async function requireAdminPageSession() {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifyAdminSessionToken(token);
  if (!session) {
    redirect("/login");
  }
  return session;
}

