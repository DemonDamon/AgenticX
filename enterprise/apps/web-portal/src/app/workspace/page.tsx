import { redirect } from "next/navigation";
import { WorkspaceClient } from "../../components/WorkspaceClient";
import { getSessionFromCookies } from "../../lib/session";

export default async function WorkspacePage() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/auth");
  }

  return <WorkspaceClient userEmail={session.email} />;
}

