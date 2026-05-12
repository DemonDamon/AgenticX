import { NextResponse } from "next/server";
import { buildPolicySnapshotBundleForGateway } from "@agenticx/feature-policy";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const bundle = await buildPolicySnapshotBundleForGateway();
    return NextResponse.json(bundle, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "policy_snapshot_bundle_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
