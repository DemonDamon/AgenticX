import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { loadUserQuotaOverview } from "../../../../../lib/quota-overview";

const MAX_USER_IDS = 100;

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const userIds = (new URL(request.url).searchParams.get("userIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (userIds.length > MAX_USER_IDS) {
    return NextResponse.json({ code: "40001", message: "一次最多查看 100 位成员" }, { status: 400 });
  }
  const items = await loadUserQuotaOverview(guard.session.tenantId, userIds);
  return NextResponse.json({ code: "00000", message: "ok", data: { items } });
}
