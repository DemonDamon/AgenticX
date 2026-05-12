import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 }
    );
  }
  const models = await listAvailableModelsForUser(session.userId, session.email);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { models },
  });
}
