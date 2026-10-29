import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  getFingerprints,
  getGraphStats,
  listSourcesWithStatus,
} from "../../../../../lib/graph-incremental-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const [sources, fingerprints, graph_stats] = await Promise.all([
      listSourcesWithStatus(),
      getFingerprints(),
      getGraphStats(),
    ]);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { sources, fingerprints, graph_stats },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load sources";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
