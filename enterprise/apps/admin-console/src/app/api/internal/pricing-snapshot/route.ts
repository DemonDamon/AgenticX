import { NextResponse } from "next/server";
import { buildPricingSnapshotForGateway } from "../../../../lib/pricing-store";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const snapshot = await buildPricingSnapshotForGateway();
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "pricing_snapshot_bundle_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
