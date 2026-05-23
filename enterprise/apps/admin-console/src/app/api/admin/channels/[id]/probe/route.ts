import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { probeGatewayChannel } from "../../../../../lib/gateway-ops-store";
import { updateChannel } from "../../../../../lib/gateway-channels-store";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const body = await probeGatewayChannel(id);
    const data = body.data as {
      supported_models?: string[];
      key_health?: Array<{ key_ref: string; status: string; last_error?: string }>;
      last_probe_error?: string;
    };
    const patch: Parameters<typeof updateChannel>[1] = {
      metadata: {
        last_probe_at: new Date().toISOString(),
        last_probe_error: data.last_probe_error ?? "",
        key_health: data.key_health ?? [],
      },
    };
    if (data.supported_models?.length) {
      patch.supportedModels = data.supported_models;
    }
    const updated = await updateChannel(id, patch);
    return NextResponse.json({ code: "00000", message: "ok", data: { probe: data, channel: updated } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "probe failed" },
      { status: 500 }
    );
  }
}
