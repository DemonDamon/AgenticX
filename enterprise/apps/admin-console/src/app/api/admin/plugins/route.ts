import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { fetchGatewayPlugins, reloadGatewayPlugins } from "../../../../lib/gateway-ops-store";
import { requireGatewayInternalToken } from "../../../../lib/gateway-internal-token";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await fetchGatewayPlugins();
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      return NextResponse.json({ code: "40000", message: "name required" }, { status: 400 });
    }
    const base = process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";
    const token = requireGatewayInternalToken();
    const upstream = new FormData();
    upstream.set("name", name);
    const manifest = form.get("manifest");
    const wasm = form.get("wasm");
    if (manifest instanceof File) upstream.set("manifest", manifest);
    if (wasm instanceof File) upstream.set("wasm", wasm);
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/plugins/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upstream,
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "upload failed" },
      { status: 500 }
    );
  }
}

export async function PUT() {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await reloadGatewayPlugins();
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "reload failed" },
      { status: 500 }
    );
  }
}
