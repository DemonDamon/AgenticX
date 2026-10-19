import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../../../lib/chat-history";
import { approveMerge } from "../../../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  recordCollabAudit,
} from "../../../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ roomId: string; seq: string }>;

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId, seq } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");
  const mergeRequestSeq = Number(seq);
  if (!Number.isInteger(mergeRequestSeq) || mergeRequestSeq < 1) {
    return collabRoomBadRequest("invalid merge request");
  }

  try {
    const message = await approveMerge(desktopRoomContext(identity), roomId, mergeRequestSeq);
    await recordCollabAudit({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      eventType: "project.merge_approve",
      targetKind: "collab_room",
      targetId: roomId,
      detail: { request_seq: mergeRequestSeq, message_id: message.id },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { message } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
