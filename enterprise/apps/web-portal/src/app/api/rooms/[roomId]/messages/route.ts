import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../lib/chat-history";
import { appendMessage, listMessages } from "../../../../../lib/collab-room";
import { mentionsMeta, triggerMetaReply } from "../../../../../lib/collab-room/meta-reply";
import {
  collabRoomBadRequest,
  collabRoomErrorResponse,
  collabRoomUnauthorized,
  senderDisplayName,
  toCollabRoomContext,
} from "../../../../../lib/collab-room-http";
import { log } from "../../../../../lib/observability/logger";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";

type Params = Promise<{ roomId: string }>;

const CONTENT_MAX = 8000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function GET(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
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
    const messages = await listMessages(toCollabRoomContext(session), roomId, { afterSeq, limit });
    return NextResponse.json({ code: "00000", message: "ok", data: { messages } });
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
    const ctx = toCollabRoomContext(session);
    const created = await appendMessage(ctx, roomId, {
      senderType: "human",
      senderId: session.userId,
      senderName: senderDisplayName(session),
      content,
    });
    if (mentionsMeta(content)) {
      await triggerMetaReply(ctx, roomId, session).catch((error) => {
        log("error", {
          event: "room.meta_reply.failed",
          room_id: roomId,
          error_message: String(error),
        });
      });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { message: created } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
