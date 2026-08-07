import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { fetchGatewayPolicyStatus } from "../../../../lib/gateway-ops-store";

export async function GET() {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;

  try {
    const body = await fetchGatewayPolicyStatus(guard.session.tenantId);
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      {
        code: "50203",
        message: error instanceof Error ? error.message : "gateway policy status unavailable",
      },
      { status: 502 },
    );
  }
}
