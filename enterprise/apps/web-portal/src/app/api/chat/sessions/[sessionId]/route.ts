import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../lib/session";
import {
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../../lib/chat-history-http";
import { ChatHistoryNotFoundError, patchChatSession, softDeleteChatSession } from "../../../../../lib/chat-history";

type Params = Promise<{ sessionId: string }>;

export async function PATCH(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) {
    return NextResponse.json({ error: { code: "40001", message: "missing session id" } }, { status: 400 });
  }
  let body: { title?: unknown; active_model?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; active_model?: unknown };
  } catch {
    body = {};
  }
  const patch: { title?: string; activeModel?: string | null } = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (body.active_model === null) patch.activeModel = null;
  else if (typeof body.active_model === "string") patch.activeModel = body.active_model;

  try {
    const ctx = toChatHistoryContext(session);
    const updated = await patchChatSession(ctx, sessionId, patch);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { session: updated },
    });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    if (error instanceof Error && error.message.includes("patch must include")) {
      return NextResponse.json({ error: { code: "40001", message: error.message } }, { status: 400 });
    }
    return chatHistoryServerError(error);
  }
}

export async function DELETE(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return chatHistoryUnauthorized();
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) {
    return NextResponse.json({ error: { code: "40001", message: "missing session id" } }, { status: 400 });
  }
  try {
    const ctx = toChatHistoryContext(session);
    await softDeleteChatSession(ctx, sessionId);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    return chatHistoryServerError(error);
  }
}
