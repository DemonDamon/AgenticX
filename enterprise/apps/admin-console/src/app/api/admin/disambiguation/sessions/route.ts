import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  createSession,
  listSessions,
  type DisambiguationSessionStatus,
} from "../../../../../lib/disambiguation-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || undefined) as
      | DisambiguationSessionStatus
      | undefined;
    const source = url.searchParams.get("source") || undefined;
    const sessions = await listSessions({ status, source });
    return NextResponse.json({ code: "00000", message: "ok", data: { sessions } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load sessions";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      source?: string;
      pending?: unknown[];
      meta?: Record<string, unknown>;
      session_id?: string;
    };
    if (!body.source?.trim()) {
      return NextResponse.json({ code: "40000", message: "source required" }, { status: 400 });
    }
    const session = await createSession({
      source: body.source,
      pending: body.pending as never,
      meta: body.meta,
      session_id: body.session_id,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { session } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
