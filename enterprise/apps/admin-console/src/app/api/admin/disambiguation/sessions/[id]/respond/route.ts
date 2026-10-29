import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  applyResponse,
  type DisambiguationResponse,
} from "../../../../../../lib/disambiguation-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as DisambiguationResponse;
    if (!body.request_id?.trim()) {
      return NextResponse.json({ code: "40000", message: "request_id required" }, { status: 400 });
    }
    const session = await applyResponse(id, body);
    return NextResponse.json({ code: "00000", message: "ok", data: { session } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "respond failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
