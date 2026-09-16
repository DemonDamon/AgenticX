import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { listMembers } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ roomId: string }>;

export async function GET(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  try {
    const members = await listMembers(desktopRoomContext(identity), roomId);
    return NextResponse.json({ code: "00000", message: "ok", data: { members } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
