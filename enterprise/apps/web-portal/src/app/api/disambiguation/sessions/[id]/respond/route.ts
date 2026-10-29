import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../../lib/session";
import {
  applyResponse,
  type DisambiguationResponse,
} from "../../../../../../lib/disambiguation-runtime-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const body = (await request.json()) as DisambiguationResponse;
    if (!body.request_id?.trim()) {
      return NextResponse.json({ code: "40000", message: "request_id required" }, { status: 400 });
    }
    const updated = await applyResponse(id, body);
    return NextResponse.json({ code: "00000", message: "ok", data: { session: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "respond failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
