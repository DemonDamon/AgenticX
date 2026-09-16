import { NextResponse } from "next/server";
import { listRooms } from "../../../../lib/collab-room";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
} from "../../../../lib/desktop-collab-room-http";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  try {
    const rooms = await listRooms(desktopRoomContext(identity));
    return NextResponse.json({ code: "00000", message: "ok", data: { rooms } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
