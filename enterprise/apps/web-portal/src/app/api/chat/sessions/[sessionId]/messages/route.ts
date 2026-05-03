import { NextResponse } from "next/server";
import type { ChatMessage } from "@agenticx/core-api";
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

type Params = Promise<{ sessionId: string }>;

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);
const MAX_MESSAGES_PER_WRITE = 100;
const MAX_MESSAGE_CONTENT_CHARS = 128_000;

function sanitizeInboundMessages(
  sessionId: string,
  tenantId: string,
  userId: string,
  raw: unknown
): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error("messages must be an array");
  if (raw.length > MAX_MESSAGES_PER_WRITE) {
    throw new Error(`messages must be <= ${MAX_MESSAGES_PER_WRITE}`);
  }
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("invalid message entry");
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const role = typeof r.role === "string" ? r.role : "";
    const content = typeof r.content === "string" ? r.content : "";
    if (!ALLOWED_ROLES.has(role)) throw new Error(`invalid role: ${role}`);
    if (role === "user" && !content.trim()) throw new Error("message content required");
    if (content.length > MAX_MESSAGE_CONTENT_CHARS) throw new Error("message content too large");
    const createdAt = typeof r.created_at === "string" ? r.created_at : new Date().toISOString();
    if (Number.isNaN(Date.parse(createdAt))) throw new Error("invalid created_at");
    const model = typeof r.model === "string" ? r.model : undefined;
    out.push({
      id,
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: role as ChatMessage["role"],
      content,
      model,
      created_at: createdAt,
    });
  }
  return out;
}

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
