import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { createSubRoom } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  recordCollabAudit,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ roomId: string }>;

function readIdList(value: unknown): string[] | "invalid" | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return "invalid";
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isValidUlid(item.trim())) return "invalid";
    ids.push(item.trim());
  }
  return ids;
}

function readMembers(value: unknown): Array<{ userId: string; displayName: string }> | "invalid" {
  if (!Array.isArray(value)) return "invalid";
  const members: Array<{ userId: string; displayName: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "invalid";
    const row = item as { user_id?: unknown; display_name?: unknown };
    const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
    const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!isValidUlid(userId) || !displayName) return "invalid";
    members.push({ userId, displayName });
  }
  return members;
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  let body: {
    title?: unknown;
    member_user_ids?: unknown;
    agent_ids?: unknown;
    seed_message_ids?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return collabRoomBadRequest("title required");
  const memberUserIds = readMembers(body.member_user_ids);
  if (memberUserIds === "invalid") return collabRoomBadRequest("invalid member_user_ids");
  const agentIds = readIdList(body.agent_ids);
  if (agentIds === "invalid") return collabRoomBadRequest("invalid agent_ids");
  const seedMessageIds = readIdList(body.seed_message_ids);
  if (seedMessageIds === "invalid") return collabRoomBadRequest("invalid seed_message_ids");

  try {
    const room = await createSubRoom(desktopRoomContext(identity), roomId, {
      title,
      memberUserIds,
      agentIds,
      seedMessageIds,
    });
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.room.sub_create",
      targetKind: "collab_room",
      targetId: room.id,
      detail: { parent_room_id: roomId, project_id: room.project_id },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { room } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
