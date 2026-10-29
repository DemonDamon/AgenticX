import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getGraphStats, getGraphStoreBackendLabel } from "../../../../../lib/graph-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const stats = await getGraphStats();
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { stats, backend: stats.backend || getGraphStoreBackendLabel() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stats failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
