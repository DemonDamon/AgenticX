import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../../lib/session";
import {
  chatHistoryBadRequest,
  chatHistoryConflict,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
  toChatHistoryContext,
} from "../../../../../../lib/chat-history-http";
import {
  appendChatMessages,
  ChatHistoryConflictError,
  ChatHistoryNotFoundError,
  getChatSessionMessages,
  replaceAllChatSessionMessages,
} from "../../../../../../lib/chat-history";
import { sanitizeInboundMessages } from "../../../../../../lib/chat-message-sanitize";

type Params = Promise<{ sessionId: string }>;

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const HASH_RE = /^[a-f0-9]{64}$/i;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
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
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) return chatHistoryUnauthorized();
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) return chatHistoryBadRequest("missing session id");

  let body: {
    messages?: unknown;
    replace_all?: unknown;
    operation_id?: unknown;
    payload_hash?: unknown;
  };
  try {
    body = (await request.json()) as {
      messages?: unknown;
      replace_all?: unknown;
      operation_id?: unknown;
      payload_hash?: unknown;
    };
  } catch {
    return chatHistoryBadRequest("invalid json body");
  }
  const replaceAll = body.replace_all === true;
  const operationId =
    typeof body.operation_id === "string" ? body.operation_id.trim() : undefined;
  const payloadHash =
    typeof body.payload_hash === "string" ? body.payload_hash.trim() : undefined;
  if (operationId !== undefined) {
    if (!ULID_RE.test(operationId)) {
      return chatHistoryBadRequest("invalid operation_id: must be a valid ULID");
    }
    if (!payloadHash || !HASH_RE.test(payloadHash)) {
      return chatHistoryBadRequest("invalid payload_hash: must be sha256 hex");
    }
  }
  try {
    const messages = sanitizeInboundMessages(sessionId, session.tenantId, session.userId, body.messages);
    const ctx = toChatHistoryContext(session);
    if (replaceAll) {
      await replaceAllChatSessionMessages(ctx, sessionId, messages);
    } else {
      await appendChatMessages(ctx, sessionId, messages, {
        operationId,
        payloadHash,
      });
    }
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    if (error instanceof ChatHistoryNotFoundError) return chatHistoryNotFound();
    if (error instanceof ChatHistoryConflictError) {
      return chatHistoryConflict(error.message);
    }
    if (error instanceof Error && /invalid|must be/.test(error.message)) {
      return chatHistoryBadRequest(error.message);
    }
    return chatHistoryServerError(error);
  }
}
