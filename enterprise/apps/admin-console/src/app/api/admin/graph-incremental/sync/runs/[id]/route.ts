import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { getSyncRun } from "../../../../../../../lib/graph-incremental-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const report = await getSyncRun(id);
    if (!report) {
      return NextResponse.json({ code: "40400", message: "sync run not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { report } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load sync run";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
