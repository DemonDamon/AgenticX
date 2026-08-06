import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";
import {
  chatHistoryBadRequest,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../lib/chat-history-http";
import {
  ChatHistoryNotFoundError,
  ChatShareValidationError,
  createChatShareSnapshot,
} from "../../../../lib/chat-history";
import { buildShareUrl } from "../../../../lib/share-url";

const MAX_MESSAGE_IDS = 200;

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) return chatHistoryUnauthorized();

  let body: { session_id?: unknown; message_ids?: unknown };
  try {
    body = (await request.json()) as { session_id?: unknown; message_ids?: unknown };
  } catch {
    return chatHistoryBadRequest("invalid json body");
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId) return chatHistoryBadRequest("session_id is required");
  if (!Array.isArray(body.message_ids)) {
    return chatHistoryBadRequest("message_ids must be an array");
  }
  const messageIds = body.message_ids.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (messageIds.length === 0) return chatHistoryBadRequest("select at least one message to share");
  if (messageIds.length > MAX_MESSAGE_IDS) {
    return chatHistoryBadRequest(`message_ids max ${MAX_MESSAGE_IDS}`);
  }

  try {
    const snapshot = await createChatShareSnapshot(
      toChatHistoryContext(session),
      sessionId,
      messageIds,
    );
    const path = `/share/${encodeURIComponent(snapshot.token)}`;
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        token: snapshot.token,
        path,
        share_url: buildShareUrl(path, request.url),
      },
    });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    if (error instanceof ChatShareValidationError) return chatHistoryBadRequest(error.message);
    return chatHistoryServerError(error);
  }
}
