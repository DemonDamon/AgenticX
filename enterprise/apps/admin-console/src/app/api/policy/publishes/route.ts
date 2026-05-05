import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { listPolicyPublishes } from "../../../../lib/policy-store";

export async function GET() {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  const events = await listPolicyPublishes(guard.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { events } });
}
