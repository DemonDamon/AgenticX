import { NextResponse } from "next/server";
import type { AuthContext } from "@agenticx/auth";
import type { ChatHistoryContext } from "./chat-history";

export function toChatHistoryContext(session: AuthContext): ChatHistoryContext {
  return { tenantId: session.tenantId, userId: session.userId };
}

export function chatHistoryUnauthorized() {
  return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
}

export function chatHistoryForbidden() {
  return NextResponse.json({ error: { code: "40301", message: "forbidden" } }, { status: 403 });
}

export function chatHistoryNotFound() {
  return NextResponse.json({ error: { code: "40401", message: "not found" } }, { status: 404 });
}

export function chatHistoryBadRequest(message: string) {
  return NextResponse.json({ error: { code: "40001", message } }, { status: 400 });
}

export function chatHistoryServerError(message: string) {
  return NextResponse.json({ error: { code: "50001", message } }, { status: 500 });
}
