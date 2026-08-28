import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../lib/chat-history";
import { leaveRoom } from "../../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";

type Params = Promise<{ roomId: string }>;

export async function POST(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  try {
    await leaveRoom(toCollabRoomContext(session), roomId);
    return NextResponse.json({ code: "00000", message: "ok", data: {} });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
