import { NextResponse } from "next/server";
import { getAdminProject } from "@agenticx/iam-core";
import { requireAdminSomeScope } from "../../../../../lib/admin-auth";
import { PROJECT_READ_SCOPES, resolveProjectVisibility } from "../../../../../lib/admin-project-visibility";
import { projectErrorResponse } from "../http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSomeScope([...PROJECT_READ_SCOPES]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const vis = await resolveProjectVisibility(auth.session, auth.scopes);
  try {
    const detail = await getAdminProject(auth.session.tenantId, id, vis);
    if (!detail) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: detail });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
