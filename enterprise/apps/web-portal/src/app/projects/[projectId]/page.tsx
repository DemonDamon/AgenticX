import { redirect } from "next/navigation";
import { ProjectDetailView } from "../../../components/projects/ProjectDetailView";
import { getWorkspaceSessionFromCookies } from "../../../lib/session";

export default async function ProjectPage(segmentData: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await segmentData.params;
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") redirect("/auth");
  if (result.status === "password_change_required") redirect("/auth/change-password");

  return <ProjectDetailView projectId={projectId} currentUserEmail={result.session.email} />;
}
