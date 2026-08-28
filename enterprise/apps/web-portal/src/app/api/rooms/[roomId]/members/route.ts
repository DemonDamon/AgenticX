import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../lib/chat-history";
import { addHumanMember, listMembers } from "../../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";

type Params = Promise<{ roomId: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  try {
    const members = await listMembers(toCollabRoomContext(session), roomId);
    return NextResponse.json({ code: "00000", message: "ok", data: { members } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  let body: { user_id?: unknown; display_name?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { user_id?: unknown; display_name?: unknown; role?: unknown };
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const targetId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!targetId) return collabRoomBadRequest("user_id required");
  const displayName =
    typeof body.display_name === "string" && body.display_name.trim()
      ? body.display_name.trim()
      : targetId;
  const role = body.role === "admin" || body.role === "member" ? body.role : undefined;
  try {
    const member = await addHumanMember(toCollabRoomContext(session), roomId, {
      userId: targetId,
      displayName,
      role,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { member } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
