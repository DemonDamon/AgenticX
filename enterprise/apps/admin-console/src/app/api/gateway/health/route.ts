import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";

function gatewayBaseUrl(): string {
  const value = process.env.GATEWAY_BASE_URL?.trim();
  if (value) return value;
  return "http://127.0.0.1:8088";
}

export async function GET() {
  const guard = await requireAdminScope(["gateway:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  try {
    const response = await fetch(`${gatewayBaseUrl()}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return NextResponse.json({ code: "50201", message: "gateway unavailable", data: { status: "degraded" } }, { status: 502 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { status: "healthy" } });
  } catch {
    return NextResponse.json({ code: "50202", message: "gateway offline", data: { status: "offline" } }, { status: 502 });
  }
}

