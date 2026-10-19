import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../lib/chat-history";
import { getProject } from "../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
} from "../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ projectId: string }>;

export async function GET(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { projectId } = await segmentData.params;
  if (!isValidUlid(projectId)) return collabRoomBadRequest("invalid project id");
  try {
    const detail = await getProject(desktopRoomContext(identity), projectId);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { project: detail.project, rooms: detail.rooms },
    });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
