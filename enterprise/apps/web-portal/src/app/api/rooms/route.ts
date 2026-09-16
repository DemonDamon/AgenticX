import { NextResponse } from "next/server";
import { createRoom, listRooms } from "../../../lib/collab-room";
import {
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  senderDisplayName,
  toCollabRoomContext,
} from "../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../lib/session";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  try {
    const rooms = await listRooms(toCollabRoomContext(session));
    return NextResponse.json({ code: "00000", message: "ok", data: { rooms } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  let body: { title?: unknown };
  try {
    body = (await request.json()) as { title?: unknown };
  } catch {
    body = {};
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "新房间";
  try {
    const room = await createRoom(toCollabRoomContext(session), {
      title,
      displayName: senderDisplayName(session),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { room } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
