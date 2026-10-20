import { NextResponse } from "next/server";
import { buildBudgetSnapshotForGateway } from "../../../../lib/budget-store";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";

export const dynamic = "force-dynamic";

const TENANT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requestedTenantId(request: Request): { ok: true; tenantId: string } | { ok: false } {
  const header = request.headers.get("x-agenticx-tenant-id")?.trim() ?? "";
  if (header) {
    if (!TENANT_ID_PATTERN.test(header)) return { ok: false };
    return { ok: true, tenantId: header };
  }
  const fallback = process.env.DEFAULT_TENANT_ID?.trim() ?? "";
  if (!fallback || !TENANT_ID_PATTERN.test(fallback)) return { ok: false };
  return { ok: true, tenantId: fallback };
}

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  const tenant = requestedTenantId(request);
  if (!tenant.ok) {
    return NextResponse.json({ error: "tenant_required", message: "tenant id is required" }, { status: 400 });
  }
  try {
    const snapshot = await buildBudgetSnapshotForGateway(tenant.tenantId);
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "budget_snapshot_bundle_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
