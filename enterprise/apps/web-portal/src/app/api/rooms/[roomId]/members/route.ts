import { NextResponse } from "next/server";
import type { AuthContext } from "@agenticx/auth";
import { AgentNotFoundError, getAgent, resolveAssignmentKeysForUser } from "@agenticx/iam-core";
import { isValidUlid } from "../../../../../lib/chat-history";
import { addAgentMember, addHumanMember, listMembers } from "../../../../../lib/collab-room";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  toCollabRoomContext,
} from "../../../../../lib/collab-room-http";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";

type Params = Promise<{ roomId: string }>;

async function addRoomAgentMember(session: AuthContext, roomId: string, agentId: string) {
  try {
    const agent = await getAgent(session.tenantId, agentId);
    if (agent.status !== "active") return collabRoomBadRequest("agent disabled");
    const keys = await resolveAssignmentKeysForUser(
      session.tenantId,
      session.userId,
      session.email,
      session.deptId,
    );
    const wanted = new Set(keys.map((key) => key.trim()).filter(Boolean));
    if (!agent.assignmentKeys.some((key) => wanted.has(key.trim()))) {
      return NextResponse.json({ error: { code: "40301", message: "agent not visible" } }, { status: 403 });
    }
    const member = await addAgentMember(toCollabRoomContext(session), roomId, {
      agentId: agent.id,
      displayName: agent.displayName,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { member } });
  } catch (error) {
    if (error instanceof AgentNotFoundError) return collabRoomBadRequest("agent not found");
    return collabRoomErrorResponse(error);
  }
}

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

  let body: { user_id?: unknown; display_name?: unknown; role?: unknown; agent_id?: unknown };
  try {
    body = (await request.json()) as {
      user_id?: unknown;
      display_name?: unknown;
      role?: unknown;
      agent_id?: unknown;
    };
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  if (agentId) return addRoomAgentMember(session, roomId, agentId);
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
