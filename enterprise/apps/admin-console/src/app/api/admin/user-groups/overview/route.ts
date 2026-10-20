import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { loadGroupLimitOverview } from "../../../../../lib/quota-overview";

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const groups = await loadGroupLimitOverview(guard.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { groups } });
}
