import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../lib/session";
import { getSession } from "../../../../../lib/disambiguation-runtime-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const row = await getSession(id);
    if (!row) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { session: row } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
