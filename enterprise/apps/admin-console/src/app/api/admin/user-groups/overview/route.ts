import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { loadGroupQuotaOverview } from "../../../../../lib/quota-overview";

export async function GET() {
  const auth = await requireAdminScope(["user:read", "metering:read"]);
  if (!auth.ok) return auth.response;
  const data = await loadGroupQuotaOverview(auth.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data });
}
