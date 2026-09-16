import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { appendMessage, listMessages } from "../../../../../../lib/collab-room";
import { mentionsMeta, triggerMetaReply } from "../../../../../../lib/collab-room/meta-reply";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopAuthContext,
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  desktopSenderName,
} from "../../../../../../lib/desktop-collab-room-http";
import { log } from "../../../../../../lib/observability/logger";

type Params = Promise<{ roomId: string }>;

const CONTENT_MAX = 8000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * 增量拉取：`?after_seq=` + `?limit=`（默认 200，上限 500）。
 * 桌面端要「最后 N 条」时：先 GET /api/desktop/rooms/:roomId 拿 room.last_seq，
 * 再请求 after_seq = Math.max(0, last_seq - N)。不要新增 before_seq，也不要改 store。
 */
export async function GET(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  const url = new URL(request.url);
  const afterRaw = url.searchParams.get("after_seq");
  let afterSeq: number | undefined;
  if (afterRaw != null && afterRaw !== "") {
    const parsed = Number(afterRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return collabRoomBadRequest("invalid after_seq");
    }
    afterSeq = parsed;
  }
  const limitRaw = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw != null && limitRaw !== "") {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return collabRoomBadRequest("invalid limit");
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  try {
    const messages = await listMessages(desktopRoomContext(identity), roomId, { afterSeq, limit });
    return NextResponse.json({ code: "00000", message: "ok", data: { messages } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return collabRoomBadRequest("invalid json body");
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return collabRoomBadRequest("content required");
  if (content.length > CONTENT_MAX) return collabRoomBadRequest("content too long");

  try {
    const ctx = desktopRoomContext(identity);
    const created = await appendMessage(ctx, roomId, {
      senderType: "human",
      senderId: identity.userId,
      senderName: desktopSenderName(identity),
      content,
    });
    if (mentionsMeta(content)) {
      await triggerMetaReply(ctx, roomId, desktopAuthContext(identity)).catch((error) => {
        log("error", {
          event: "room.meta_reply.failed",
          room_id: roomId,
          error_message: String(error),
        });
      });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { message: created } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
