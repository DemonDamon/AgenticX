import { redirect } from "next/navigation";
import { WorkspaceShell } from "../../components/WorkspaceShell";
import { getSessionFromCookies } from "../../lib/session";

export default async function WorkspacePage() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/auth");
  }

  return <WorkspaceShell userEmail={session.email} userScopes={session.scopes} />;
}

