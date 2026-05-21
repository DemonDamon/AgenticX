import { NextResponse } from "next/server";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";
import { listChannelsInternal } from "../../../../lib/gateway-channels-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const channels = await listChannelsInternal();
    return NextResponse.json({ channels }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "channels_bundle_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
