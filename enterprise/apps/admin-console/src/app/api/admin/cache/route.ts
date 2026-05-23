import { NextResponse } from "next/server";
import { evictCachePrefix, readCacheConfig, writeCacheConfig, type GatewayCacheConfig } from "../../../../lib/gateway-cache-store";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { getGatewayInternalToken } from "../../../../lib/gateway-internal-token";

export async function GET() {
  const guard = await requireAdminScope(["provider:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  const config = await readCacheConfig();
  return NextResponse.json({ code: "00000", message: "ok", data: config });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: GatewayCacheConfig;
  try {
    body = (await request.json()) as GatewayCacheConfig;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  await writeCacheConfig(body);
  const gatewayBase = process.env.GATEWAY_INTERNAL_URL?.trim() || "http://127.0.0.1:8080";
  const token = getGatewayInternalToken();
  if (token) {
    await fetch(`${gatewayBase}/internal/cache/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  return NextResponse.json({ code: "00000", message: "ok", data: body });
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: { prefix?: string };
  try {
    body = (await request.json()) as { prefix?: string };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const prefix = typeof body.prefix === "string" ? body.prefix : "";
  await evictCachePrefix(prefix);
  return NextResponse.json({ code: "00000", message: "ok" });
}
