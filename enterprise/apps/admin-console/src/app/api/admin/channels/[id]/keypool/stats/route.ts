import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { fetchGatewayKeypoolStats, resetGatewayKeypoolCooldown } from "../../../../../../../lib/gateway-channels-store";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const keyRefs = (url.searchParams.get("key_refs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = await fetchGatewayKeypoolStats(id, keyRefs);
  return NextResponse.json({ code: "00000", message: "ok", data: { channelId: id, keys } });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = (await request.json()) as { keyRef?: string };
  if (!body.keyRef?.trim()) {
    return NextResponse.json({ code: "40000", message: "keyRef required" }, { status: 400 });
  }
  await resetGatewayKeypoolCooldown(id, body.keyRef.trim());
  return NextResponse.json({ code: "00000", message: "ok" });
}
