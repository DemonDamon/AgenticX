import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getNeighborhood } from "../../../../../lib/graph-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    const depth = Number(url.searchParams.get("depth") || "1");
    const limit = Number(url.searchParams.get("limit") || "200");
    const neighborhood = await getNeighborhood(id, { depth, limit });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: neighborhood,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "neighborhood failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
