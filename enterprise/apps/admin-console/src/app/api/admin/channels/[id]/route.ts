import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  deleteChannel,
  fetchGatewayChannelStats,
  listChannels,
  updateChannel,
  type ChannelStatus,
  type UpdateChannelInput,
} from "../../../../../lib/gateway-channels-store";

function parseStatus(value: unknown): ChannelStatus | undefined {
  if (value === "active" || value === "disabled") return value;
  return undefined;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const channels = await listChannels();
  const channel = channels.find((c) => c.id === id);
  if (!channel) {
    return NextResponse.json({ code: "40400", message: "channel not found" }, { status: 404 });
  }
  const stats = await fetchGatewayChannelStats();
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { channel, health: stats[id] ?? null },
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input: UpdateChannelInput = {};
    if (typeof body.name === "string") input.name = body.name;
    if (typeof body.providerType === "string") input.providerType = body.providerType;
    if (typeof body.baseUrl === "string") input.baseUrl = body.baseUrl;
    if (typeof body.apiKey === "string") input.apiKey = body.apiKey;
    if (typeof body.weight === "number") input.weight = body.weight;
    if (typeof body.priority === "number") input.priority = body.priority;
    if (parseStatus(body.status)) input.status = parseStatus(body.status);
    if (Array.isArray(body.supportedModels)) {
      input.supportedModels = body.supportedModels.filter((m): m is string => typeof m === "string");
    }
    if (body.metadata && typeof body.metadata === "object") {
      input.metadata = body.metadata as Record<string, unknown>;
    }
    const updated = await updateChannel(id, input);
    return NextResponse.json({ code: "00000", message: "ok", data: { channel: updated } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    await deleteChannel(id);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "delete failed" },
      { status: 400 }
    );
  }
}
