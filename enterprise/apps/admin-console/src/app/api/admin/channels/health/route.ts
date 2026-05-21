import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { fetchGatewayChannelStats, listChannels } from "../../../../../lib/gateway-channels-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const channels = await listChannels();
  const stats = await fetchGatewayChannelStats();
  return NextResponse.json({ code: "00000", message: "ok", data: { channels, stats } });
}
