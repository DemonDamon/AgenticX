import { redirect } from "next/navigation";
import { ProjectListView } from "../../components/projects/ProjectListView";
import { getWorkspaceSessionFromCookies } from "../../lib/session";

export default async function ProjectsPage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") redirect("/auth");
  if (result.status === "password_change_required") redirect("/auth/change-password");

  return <ProjectListView currentUserEmail={result.session.email} />;
}
