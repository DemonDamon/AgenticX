import { NextResponse } from "next/server";
import { syncPendingSplit } from "../../../../../lib/billing-service";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let limit = 200;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === "number" && body.limit > 0) limit = body.limit;
  } catch {
    // optional body
  }
  try {
    const result = await syncPendingSplit(limit);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message, data: { synced: 0 } }, { status: 500 });
  }
}
