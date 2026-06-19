import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../../lib/session";
import {
  chatHistoryBadRequest,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../../../lib/chat-history-http";
import {
  appendChatMessages,
  ChatHistoryNotFoundError,
  getChatSessionMessages,
  replaceAllChatSessionMessages,
} from "../../../../../../lib/chat-history";
import { sanitizeInboundMessages } from "../../../../../../lib/chat-message-sanitize";

type Params = Promise<{ sessionId: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) return chatHistoryBadRequest("missing session id");
  try {
    const ctx = toChatHistoryContext(session);
    const messages = await getChatSessionMessages(ctx, sessionId);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { messages },
    });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    return chatHistoryServerError(error);
  }
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) return chatHistoryBadRequest("missing session id");

  let body: { messages?: unknown; replace_all?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown; replace_all?: unknown };
  } catch {
    return chatHistoryBadRequest("invalid json body");
  }
  const replaceAll = body.replace_all === true;
  try {
    const messages = sanitizeInboundMessages(sessionId, session.tenantId, session.userId, body.messages);
    const ctx = toChatHistoryContext(session);
    if (replaceAll) {
      await replaceAllChatSessionMessages(ctx, sessionId, messages);
    } else {
      await appendChatMessages(ctx, sessionId, messages);
    }
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    if (error instanceof Error && /invalid|must be/.test(error.message)) {
      return chatHistoryBadRequest(error.message);
    }
    return chatHistoryServerError(error);
  }
}
