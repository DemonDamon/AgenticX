import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { removeMember } from "../../../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../../lib/session";

type Params = Promise<{ roomId: string; memberId: string }>;

export async function DELETE(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { roomId, memberId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  if (!isValidUlid(memberId)) return collabRoomBadRequest("invalid member id");
  try {
    await removeMember(toCollabRoomContext(session), roomId, memberId);
    return NextResponse.json({ code: "00000", message: "ok", data: {} });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
