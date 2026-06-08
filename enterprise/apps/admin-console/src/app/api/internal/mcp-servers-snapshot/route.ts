import { NextResponse } from "next/server";
import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";
import { listMcpProxyServersInternal } from "../../../../lib/mcp-proxy-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const servers = await listMcpProxyServersInternal();
    const tenantId = process.env.DEFAULT_TENANT_ID?.trim() ?? "";
    const payload = servers.map((s) => ({
      ...s,
      tenantId,
    }));
    return NextResponse.json({ servers: payload }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "mcp_servers_snapshot_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
