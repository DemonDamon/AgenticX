import { NextResponse } from "next/server";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";
import { getQuotaConfig } from "../../../../lib/token-quota-store";

export const dynamic = "force-dynamic";

function requestedTenantId(request: Request): string | null {
  const header = request.headers.get("x-agenticx-tenant-id")?.trim();
  const tenantId = header || process.env.DEFAULT_TENANT_ID?.trim() || "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(tenantId) ? tenantId : null;
}

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  const tenantId = requestedTenantId(request);
  if (!tenantId) {
    return NextResponse.json(
      { error: "tenant_required", message: "x-agenticx-tenant-id is required" },
      { status: 400 },
    );
  }
  try {
    const quota = await getQuotaConfig(tenantId);
    return NextResponse.json(quota, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "quotas_bundle_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
