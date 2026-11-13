import { NextResponse } from "next/server";
import { buildSessionRevocationSnapshotForGateway } from "@agenticx/iam-core";

import {
  gatewayInternalUnauthorized,
  isGatewayInternalAuthorized,
} from "../../../../lib/gateway-internal-auth";

export const dynamic = "force-dynamic";

/**
 * SP5 incident-response：JWT session 吊销快照（网关轮询数据源，pat-revocation-snapshot 同款）。
 * 网关经 GATEWAY_REMOTE_SESSION_REVOCATION_URL 轮询，处置端点 InvalidateLocal 即时生效、
 * 本快照兜底重启恢复与多副本感知。
 */
export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const snapshot = await buildSessionRevocationSnapshotForGateway();
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "session_revocation_snapshot_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
