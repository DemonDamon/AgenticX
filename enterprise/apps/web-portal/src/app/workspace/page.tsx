import { redirect } from "next/navigation";
import { WorkspaceShell } from "../../components/WorkspaceShell";
import { getWorkspaceSessionFromCookies } from "../../lib/session";

export default async function WorkspacePage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") {
    redirect("/auth");
  }
  if (result.status === "password_change_required") {
    redirect("/auth/change-password");
  }

  const { session } = result;
  return <WorkspaceShell userEmail={session.email} userScopes={session.scopes} />;
}
