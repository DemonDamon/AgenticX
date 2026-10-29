import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getSubgraph } from "../../../../../lib/graph-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const limitNodes = Number(url.searchParams.get("limit_nodes") || "200");
    const idsRaw = url.searchParams.get("ids");
    const entityIds = idsRaw
      ? idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const subgraph = await getSubgraph({ entityIds, limitNodes });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        ...subgraph,
        backend: subgraph.backend,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "subgraph failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
