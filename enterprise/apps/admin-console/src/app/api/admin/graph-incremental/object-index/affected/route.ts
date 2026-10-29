import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getAffectedForSource } from "../../../../../../lib/graph-incremental-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const sourceId =
      url.searchParams.get("sourceId")?.trim() ||
      url.searchParams.get("source")?.trim() ||
      "";
    if (!sourceId) {
      return NextResponse.json(
        { code: "40000", message: "sourceId query required" },
        { status: 400 },
      );
    }
    const affected = await getAffectedForSource(sourceId);
    return NextResponse.json({ code: "00000", message: "ok", data: affected });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to resolve affected";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
