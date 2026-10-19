import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { addProjectMember, type CollabRoomRole } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  recordCollabAudit,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ projectId: string }>;

function readRole(value: unknown): CollabRoomRole | undefined | "invalid" {
  if (value == null || value === "") return undefined;
  if (value === "owner" || value === "admin" || value === "member") return value;
  return "invalid";
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { projectId } = await segmentData.params;
  if (!isValidUlid(projectId)) return collabRoomBadRequest("invalid project id");

  let body: { user_id?: unknown; display_name?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!isValidUlid(userId)) return collabRoomBadRequest("invalid user id");
  if (!displayName) return collabRoomBadRequest("display_name required");
  const role = readRole(body.role);
  if (role === "invalid") return collabRoomBadRequest("invalid role");

  try {
    const member = await addProjectMember(desktopRoomContext(identity), projectId, {
      userId,
      displayName,
      role,
    });
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.member.add",
      targetKind: "project",
      targetId: projectId,
      detail: { user_id: member.member_id, role: member.room_role },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { member } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
