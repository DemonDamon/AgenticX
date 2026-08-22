import { redirect } from "next/navigation";

import { getSessionFromCookies } from "../../../lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/auth");
  }
  if (!session.mustChangePassword) {
    redirect("/workspace");
  }

  return <ChangePasswordForm email={session.email} />;
}
