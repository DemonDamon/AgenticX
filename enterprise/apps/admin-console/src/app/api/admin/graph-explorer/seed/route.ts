import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { seedBrandAGraph } from "../../../../../lib/graph-store";

export async function POST() {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const data = await seedBrandAGraph();
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
