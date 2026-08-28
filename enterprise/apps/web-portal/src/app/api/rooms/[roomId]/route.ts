import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../lib/chat-history";
import { getRoom, listMembers } from "../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";

type Params = Promise<{ roomId: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  try {
    const ctx = toCollabRoomContext(session);
    const [room, members] = await Promise.all([getRoom(ctx, roomId), listMembers(ctx, roomId)]);
    return NextResponse.json({ code: "00000", message: "ok", data: { room, members } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
