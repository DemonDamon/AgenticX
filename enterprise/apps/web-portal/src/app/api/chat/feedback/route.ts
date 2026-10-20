import { NextResponse } from "next/server";

import {
  chatHistoryBadRequest,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
} from "../../../../lib/chat-history-http";
import {
  ChatFeedbackTargetNotFoundError,
  ChatFeedbackValidationError,
  deleteChatMessageFeedback,
  listChatMessageFeedback,
  upsertChatMessageFeedback,
} from "../../../../lib/chat-feedback";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";

export const runtime = "nodejs";

const MAX_BODY_CHARS = 16_384;

type SessionContext = NonNullable<Awaited<ReturnType<typeof getSessionFromCookies>>>;
type AuthenticationResult = { response: Response } | { session: SessionContext };

async function authenticate(): Promise<AuthenticationResult> {
  const session = await getSessionFromCookies();
  if (!session) return { response: chatHistoryUnauthorized() };
  if (session.mustChangePassword) return { response: passwordChangeRequiredResponse() };
  return { session };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) throw new ChatFeedbackValidationError("request body too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChatFeedbackValidationError("invalid json body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChatFeedbackValidationError("invalid json body");
  }
  return parsed as Record<string, unknown>;
}

async function readBodyOrQuery(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim()) return readBody(new Request(request.url, { method: request.method, body: raw }));
  const url = new URL(request.url);
  return {
    session_id: url.searchParams.get("session_id") ?? "",
    message_id: url.searchParams.get("message_id") ?? "",
  };
}

function stringField(body: Record<string, unknown>, name: string): string {
  return typeof body[name] === "string" ? body[name].trim() : "";
}

function publicView(view: {
  messageId: string;
  sessionId: string;
  value: "like" | "dislike" | null;
  counts: { like: number; dislike: number; total: number };
}) {
  return {
    message_id: view.messageId,
    session_id: view.sessionId,
    value: view.value,
    counts: view.counts,
  };
}

function handleError(error: unknown): Response {
  if (error instanceof ChatFeedbackValidationError) {
    return chatHistoryBadRequest(error.message);
  }
  if (error instanceof ChatFeedbackTargetNotFoundError) {
    return chatHistoryNotFound();
  }
  return chatHistoryServerError(error);
}

function actorFrom(session: SessionContext) {
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    departmentId: session.deptId ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim() ?? "";
  const messageIds = [
    ...url.searchParams.getAll("message_id").flatMap((value) => value.split(",")),
    ...((url.searchParams.get("message_ids") ?? "").split(",")),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  if (!sessionId) return chatHistoryBadRequest("session_id is required");
  try {
    const items = await listChatMessageFeedback({
      actor: actorFrom(auth.session),
      sessionId,
      messageIds: messageIds.length > 0 ? messageIds : undefined,
    });
    return NextResponse.json(
      { code: "00000", message: "ok", data: { items: items.map(publicView) } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

async function writeFeedback(request: Request): Promise<Response> {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const body = await readBody(request);
    const result = await upsertChatMessageFeedback({
      actor: actorFrom(auth.session),
      sessionId: stringField(body, "session_id"),
      messageId: stringField(body, "message_id"),
      value: stringField(body, "value") as "like" | "dislike",
    });
    return NextResponse.json(
      {
        code: "00000",
        message: "ok",
        data: {
          feedback: publicView(result.view),
          viewer_value: result.view.value,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

/** PUT is the idempotent upsert: a later vote for the same message overwrites. */
export async function PUT(request: Request): Promise<Response> {
  return writeFeedback(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const body = await readBodyOrQuery(request);
    const result = await deleteChatMessageFeedback({
      actor: actorFrom(auth.session),
      sessionId: stringField(body, "session_id"),
      messageId: stringField(body, "message_id"),
    });
    return NextResponse.json(
      {
        code: "00000",
        message: "ok",
        data: {
          feedback: publicView(result.view),
          viewer_value: null,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}
