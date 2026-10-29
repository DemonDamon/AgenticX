import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getSession } from "../../../../../../lib/disambiguation-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ code: "40400", message: "session not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { session } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load session";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
