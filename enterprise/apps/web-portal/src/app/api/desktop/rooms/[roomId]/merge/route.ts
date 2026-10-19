import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { mergeBack, type CollabMergeMode } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  recordCollabAudit,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ roomId: string }>;

function readMode(value: unknown): CollabMergeMode | null {
  if (value === "all" || value === "selected" || value === "summary") return value;
  return null;
}

function readIdList(value: unknown): string[] | undefined | "invalid" {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return "invalid";
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isValidUlid(item.trim())) return "invalid";
    ids.push(item.trim());
  }
  return ids;
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  let body: {
    target_room_id?: unknown;
    mode?: unknown;
    message_ids?: unknown;
    summary_text?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const targetRoomId = typeof body.target_room_id === "string" ? body.target_room_id.trim() : "";
  if (!isValidUlid(targetRoomId)) return collabRoomBadRequest("invalid target room id");
  const mode = readMode(body.mode);
  if (!mode) return collabRoomBadRequest("invalid mode");
  const messageIds = readIdList(body.message_ids);
  if (messageIds === "invalid") return collabRoomBadRequest("invalid message_ids");
  if (body.summary_text != null && typeof body.summary_text !== "string") {
    return collabRoomBadRequest("invalid summary_text");
  }
  const summaryText = typeof body.summary_text === "string" ? body.summary_text : undefined;

  try {
    const result = await mergeBack(desktopRoomContext(identity), roomId, {
      targetRoomId,
      mode,
      messageIds,
      summaryText,
    });
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.merge_back",
      targetKind: "collab_room",
      targetId: roomId,
      detail: {
        target_room_id: targetRoomId,
        mode,
        pending: result.pending,
      },
    });
    if (result.pending) {
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: { pending: true, request_seq: result.request_seq },
      });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { message: result.message } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
