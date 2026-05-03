import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import {
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../lib/chat-history-http";
import { createChatSession, listChatSessions } from "../../../../lib/chat-history";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
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
