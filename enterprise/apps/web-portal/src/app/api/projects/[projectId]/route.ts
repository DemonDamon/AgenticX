import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../lib/chat-history";
import { getProject } from "../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";

type Params = Promise<{ projectId: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const { projectId } = await segmentData.params;
  if (!isValidUlid(projectId)) return collabRoomBadRequest("invalid project id");
  try {
    const detail = await getProject(toCollabRoomContext(session), projectId);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { project: detail.project, rooms: detail.rooms },
    });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
