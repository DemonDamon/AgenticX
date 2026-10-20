import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";
import {
  chatHistoryBadRequest,
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../lib/chat-history-http";
import { createChatSession, listChatSessions, listChatSessionsPage } from "../../../../lib/chat-history";
import {
  decodeSessionListCursor,
  encodeSessionListCursor,
} from "../../../../lib/chat-history/session-list-cursor";

const DEFAULT_SESSION_PAGE_SIZE = 40;

export async function GET(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  const searchParams = new URL(request.url).searchParams;
  const rawLimit = searchParams.get("limit");
  const rawCursor = searchParams.get("cursor");
  if (rawLimit !== null || rawCursor !== null) {
    if (rawLimit !== null && (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)) {
      return chatHistoryBadRequest("invalid history page limit");
    }
    const cursor = rawCursor === null ? null : decodeSessionListCursor(rawCursor);
    if (rawCursor !== null && cursor === null) {
      return chatHistoryBadRequest("invalid history page cursor");
    }
    const limit = rawLimit === null ? DEFAULT_SESSION_PAGE_SIZE : Number(rawLimit);
    try {
      const ctx = toChatHistoryContext(session);
      const page = await listChatSessionsPage(ctx, { limit, cursor });
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: {
          sessions: page.sessions,
          next_cursor: page.nextCursor ? encodeSessionListCursor(page.nextCursor) : null,
        },
      });
    } catch (error) {
      return chatHistoryServerError(error);
    }
  }
  try {
    const ctx = toChatHistoryContext(session);
    const sessions = await listChatSessions(ctx);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { sessions },
    });
  } catch (error) {
    return chatHistoryServerError(error);
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  let body: { title?: unknown; active_model?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; active_model?: unknown };
  } catch {
    body = {};
  }
  const title = typeof body.title === "string" ? body.title : "New chat";
  const activeModel = typeof body.active_model === "string" ? body.active_model : undefined;
  try {
    const ctx = toChatHistoryContext(session);
    const created = await createChatSession(ctx, { title, activeModel });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { session: created },
    });
  } catch (error) {
    return chatHistoryServerError(error);
  }
}
