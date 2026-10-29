import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { listSyncRuns } from "../../../../../../lib/graph-incremental-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const runs = await listSyncRuns();
    return NextResponse.json({ code: "00000", message: "ok", data: { runs } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load sync runs";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
