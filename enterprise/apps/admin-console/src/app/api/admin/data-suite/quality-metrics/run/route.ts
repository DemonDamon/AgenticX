import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { runQualityDay } from "../../../../../../lib/data-suite-store";

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      day?: string;
      rows?: Record<string, unknown>[];
    };
    const day = (body.day || new Date().toISOString().slice(0, 10)).trim();
    if (!day) {
      return NextResponse.json({ code: "40000", message: "day required" }, { status: 400 });
    }
    const last_run = await runQualityDay(day, body.rows);
    return NextResponse.json({ code: "00000", message: "ok", data: { last_run } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "run failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
