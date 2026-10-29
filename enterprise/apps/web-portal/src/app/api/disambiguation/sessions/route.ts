import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import {
  createSession,
  listSessions,
  type DisambiguationSessionStatus,
} from "../../../../lib/disambiguation-runtime-store";

export async function GET(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
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
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
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
    const created = await createSession({
      source: body.source,
      pending: body.pending as never,
      meta: body.meta,
      session_id: body.session_id,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { session: created } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
