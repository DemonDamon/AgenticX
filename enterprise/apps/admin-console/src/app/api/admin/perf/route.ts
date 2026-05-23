import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { fetchGatewayPerfConfig } from "../../../../lib/gateway-ops-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await fetchGatewayPerfConfig();
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}
