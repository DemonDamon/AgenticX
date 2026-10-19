import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../lib/chat-history";
import { createProject, listProjects, type CollabProjectSettings } from "../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  desktopSenderName,
  recordCollabAudit,
} from "../../../../lib/desktop-collab-room-http";

const NAME_MAX = 15;

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const text = item.trim();
    if (text) items.push(text);
  }
  return items;
}

function readSettings(value: unknown): CollabProjectSettings | "invalid" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return "invalid";
  const record = value as Record<string, unknown>;
  const connectors = record.connectors == null ? [] : readStringList(record.connectors);
  const experts = record.experts == null ? [] : readStringList(record.experts);
  const skills = record.skills == null ? [] : readStringList(record.skills);
  if (!connectors || !experts || !skills) return "invalid";
  return { connectors, experts, skills };
}

function readMembers(
  value: unknown,
): Array<{ userId: string; displayName: string }> | "invalid" | undefined {
  if (value == null) return undefined;
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

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  try {
    const projects = await listProjects(desktopRoomContext(identity));
    return NextResponse.json({ code: "00000", message: "ok", data: { projects } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  let body: {
    name?: unknown;
    instructions?: unknown;
    settings?: unknown;
    member_user_ids?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return collabRoomBadRequest("name required");
  if (name.length > NAME_MAX) return collabRoomBadRequest("name too long");
  if (body.instructions != null && typeof body.instructions !== "string") {
    return collabRoomBadRequest("invalid instructions");
  }
  const settings = readSettings(body.settings);
  if (settings === "invalid") return collabRoomBadRequest("invalid settings");
  const memberUserIds = readMembers(body.member_user_ids);
  if (memberUserIds === "invalid") return collabRoomBadRequest("invalid member_user_ids");

  try {
    const project = await createProject(desktopRoomContext(identity), {
      name,
      instructions: typeof body.instructions === "string" ? body.instructions : undefined,
      settings,
      deptId: identity.deptId,
      displayName: desktopSenderName(identity),
      memberUserIds,
    });
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.create",
      targetKind: "project",
      targetId: project.id,
      detail: { name: project.name, main_room_id: project.main_room_id },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { project } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
