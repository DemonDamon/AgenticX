import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";
import {
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../../lib/chat-history-http";
import { softDeleteChatSessions } from "../../../../../lib/chat-history";

const MAX_BATCH = 100;

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) return chatHistoryUnauthorized();

  let body: { session_ids?: unknown };
  try {
    body = (await request.json()) as { session_ids?: unknown };
  } catch {
    return NextResponse.json(
      { error: { code: "40001", message: "invalid json body" } },
      { status: 400 },
    );
  }

  const raw = body.session_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: { code: "40001", message: "session_ids must be a non-empty array" } },
      { status: 400 },
    );
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json(
      { error: { code: "40001", message: `session_ids max ${MAX_BATCH}` } },
      { status: 400 },
    );
  }
  const sessionIds = raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (sessionIds.length === 0) {
    return NextResponse.json(
      { error: { code: "40001", message: "session_ids must contain strings" } },
      { status: 400 },
    );
  }

  try {
    const ctx = toChatHistoryContext(session);
    const deleted = await softDeleteChatSessions(ctx, sessionIds);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { deleted },
    });
  } catch (error) {
    return chatHistoryServerError(error);
  }
}
