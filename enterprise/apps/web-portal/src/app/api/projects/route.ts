import { NextResponse } from "next/server";
import { listProjects } from "../../../lib/collab-room";
import {
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../lib/session";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  try {
    const projects = await listProjects(toCollabRoomContext(session));
    return NextResponse.json({ code: "00000", message: "ok", data: { projects } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
