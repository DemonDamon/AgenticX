import { NextResponse } from "next/server";
import { requireAdminSomeScope } from "../../../../../lib/admin-auth";
import { getSessionConversation } from "../../../../../lib/trace-conversation-io";

function isSessionId(value: string): boolean {
  // Accept ULID-shaped ids and other non-empty session keys already stored by portal.
  return value.length >= 8 && value.length <= 128 && /^[0-9A-Za-z_.:-]+$/.test(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const guard = await requireAdminSomeScope(["audit:read:all", "audit:read:dept", "audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }

  const { sessionId: raw } = await context.params;
  const sessionId = raw?.trim() ?? "";
  if (!isSessionId(sessionId)) {
    return NextResponse.json({ code: "40001", message: "invalid session_id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const expand = url.searchParams.get("expand") === "1";
  const before = url.searchParams.get("before")?.trim() || undefined;

  try {
    const data = await getSessionConversation(guard.session.tenantId, sessionId, {
      expand,
      before,
    });
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50002", message, data: undefined }, { status: 500 });
  }
}
