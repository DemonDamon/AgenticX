import { NextResponse } from "next/server";
import { requireAdminSomeScope } from "../../../../lib/admin-auth";
import { parseOptionalPortalLogString } from "../../../../lib/portal-logs-query-filters";
import { normalizePortalLogLimit } from "../../../../lib/portal-logs-query";
import { queryPortalLogSessions } from "../../../../lib/portal-logs-session-query";

export async function POST(request: Request) {
  const guard = await requireAdminSomeScope(["audit:read:all", "audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }

  const fields = [
    "user_id",
    "session_id",
    "level",
    "event",
    "route",
    "mode",
    "run_id",
    "start",
    "end",
  ] as const;
  const parsed: Record<(typeof fields)[number], string | undefined> = {
    user_id: undefined,
    session_id: undefined,
    level: undefined,
    event: undefined,
    route: undefined,
    mode: undefined,
    run_id: undefined,
    start: undefined,
    end: undefined,
  };
  for (const field of fields) {
    const result = parseOptionalPortalLogString(body[field], field);
    if (!result.ok) {
      return NextResponse.json({ code: "40001", message: result.message }, { status: 400 });
    }
    parsed[field] = result.value;
  }

  const limit = normalizePortalLogLimit(typeof body.limit === "number" ? body.limit : 100);
  const offset =
    typeof body.offset === "number" && Number.isFinite(body.offset) && body.offset >= 0
      ? Math.floor(body.offset)
      : 0;

  try {
    const data = await queryPortalLogSessions({
      tenant_id: guard.session.tenantId,
      user_id: parsed.user_id,
      session_id: parsed.session_id,
      level: parsed.level,
      event: parsed.event,
      route: parsed.route,
      mode: parsed.mode,
      run_id: parsed.run_id,
      start: parsed.start,
      end: parsed.end,
      limit,
      offset,
    });
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50002", message, data: undefined }, { status: 500 });
  }
}
