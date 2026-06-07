import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { publishQuotaPlan } from "../../../../../../lib/quota-plans-store";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const result = await publishQuotaPlan(id);
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "publish failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40401" : "40002", message }, { status });
  }
}
