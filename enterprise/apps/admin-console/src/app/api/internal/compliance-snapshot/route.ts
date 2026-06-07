import { NextResponse } from "next/server";
import { buildComplianceSnapshotForGateway } from "@agenticx/iam-core";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  const snapshot = await buildComplianceSnapshotForGateway(tenantId);
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
