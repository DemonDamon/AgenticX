import { redirect } from "next/navigation";
import { getSessionFromCookies } from "../lib/session";

export default async function Page() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/auth");
  }
  redirect(session.mustChangePassword ? "/auth/change-password" : "/workspace");
}
