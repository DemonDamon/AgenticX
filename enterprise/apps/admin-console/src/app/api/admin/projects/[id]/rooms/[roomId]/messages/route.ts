import { NextResponse } from "next/server";
import { getAdminProject, insertAuditEvent, listAdminProjectMessages } from "@agenticx/iam-core";
import { requireAdminSomeScope } from "../../../../../../../../lib/admin-auth";
import { PROJECT_READ_SCOPES, resolveProjectVisibility } from "../../../../../../../../lib/admin-project-visibility";
import { projectErrorResponse, readMessageQuery } from "../../../../http";

type Params = Promise<{ id: string; roomId: string }>;

export async function GET(request: Request, context: { params: Params }) {
  const auth = await requireAdminSomeScope([...PROJECT_READ_SCOPES]);
  if (!auth.ok) return auth.response;
  const { id, roomId } = await context.params;
  const parsed = readMessageQuery(new URL(request.url));
  if ("error" in parsed) {
    return NextResponse.json({ code: "40001", message: parsed.error }, { status: 400 });
  }
  const vis = await resolveProjectVisibility(auth.session, auth.scopes);
  try {
    const detail = await getAdminProject(auth.session.tenantId, id, vis);
    if (!detail || !detail.rooms.some((room) => room.id === roomId)) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    const data = await listAdminProjectMessages(auth.session.tenantId, roomId, vis, {
      afterSeq: parsed.afterSeq,
      limit: parsed.limit,
    });
    await insertAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.userId,
      eventType: "project.room.view",
      targetKind: "collab_room",
      targetId: roomId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
