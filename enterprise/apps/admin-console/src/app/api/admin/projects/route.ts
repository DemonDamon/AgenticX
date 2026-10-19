import { NextResponse } from "next/server";
import { listAdminProjects } from "@agenticx/iam-core";
import { requireAdminSomeScope } from "../../../../lib/admin-auth";
import { PROJECT_READ_SCOPES, resolveProjectVisibility } from "../../../../lib/admin-project-visibility";
import { projectErrorResponse, readProjectListQuery } from "./http";

export async function GET(request: Request) {
  const auth = await requireAdminSomeScope([...PROJECT_READ_SCOPES]);
  if (!auth.ok) return auth.response;
  const vis = await resolveProjectVisibility(auth.session, auth.scopes);
  try {
    const data = await listAdminProjects(
      auth.session.tenantId,
      vis,
      readProjectListQuery(new URL(request.url)),
    );
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
