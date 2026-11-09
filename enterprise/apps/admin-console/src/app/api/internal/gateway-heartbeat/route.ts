import { NextResponse } from "next/server";

import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";
import { parseHeartbeatBody, recordGatewayHeartbeat } from "../../../../lib/gateway-instances-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ code: "40000", message: "invalid request" }, { status: 400 });
  }
  const parsed = parseHeartbeatBody(raw);
  if (!parsed) {
    return NextResponse.json({ code: "40000", message: "invalid request" }, { status: 400 });
  }
  try {
    await recordGatewayHeartbeat(parsed);
  } catch {
    return NextResponse.json({ code: "50000", message: "gateway heartbeat unavailable" }, { status: 500 });
  }
  return NextResponse.json({ code: "00000", message: "ok" });
}
