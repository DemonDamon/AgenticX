import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: session,
  });
}

