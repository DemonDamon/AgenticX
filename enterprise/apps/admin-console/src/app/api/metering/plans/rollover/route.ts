import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { rolloverDueAssignments } from "../../../../../lib/quota-plans-store";

export async function POST() {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  try {
    const results = await rolloverDueAssignments();
    return NextResponse.json({ code: "00000", message: "ok", data: { results } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rollover failed";
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
