import { NextResponse } from "next/server";
import { requireAdminSomeScope } from "../../../../lib/admin-auth";
import { fetchGatewayErrors } from "../../../../lib/gateway-ops-store";

export async function GET(request: Request) {
  const auth = await requireAdminSomeScope(["audit:read:all", "audit:read", "audit:read:dept"]);
  if (!auth.ok) return auth.response;
  const tenantId = new URL(request.url).searchParams.get("tenant_id") ?? auth.session.tenantId;
  try {
    const body = await fetchGatewayErrors(tenantId);
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}
