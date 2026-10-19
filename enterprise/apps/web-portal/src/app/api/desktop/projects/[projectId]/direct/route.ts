import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { openDirectRoom } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  recordCollabAudit,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ projectId: string }>;

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { projectId } = await segmentData.params;
  if (!isValidUlid(projectId)) return collabRoomBadRequest("invalid project id");

  let body: { peer_user_id?: unknown; peer_display_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const peerUserId = typeof body.peer_user_id === "string" ? body.peer_user_id.trim() : "";
  const peerDisplayName = typeof body.peer_display_name === "string" ? body.peer_display_name.trim() : "";
  if (!isValidUlid(peerUserId)) return collabRoomBadRequest("invalid peer user id");
  if (!peerDisplayName) return collabRoomBadRequest("peer_display_name required");

  try {
    const room = await openDirectRoom(desktopRoomContext(identity), projectId, {
      peerUserId,
      peerDisplayName,
    });
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.room.direct_open",
      targetKind: "collab_room",
      targetId: room.id,
      detail: { project_id: projectId, peer_user_id: peerUserId },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { room } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
