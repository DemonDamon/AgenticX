import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { createChannel, listChannels, type CreateChannelInput, type ChannelStatus } from "../../../../lib/gateway-channels-store";

function parseStatus(value: unknown): ChannelStatus | undefined {
  if (value === "active" || value === "disabled") return value;
  return undefined;
}

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const channels = await listChannels();
  return NextResponse.json({ code: "00000", message: "ok", data: { channels } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:create"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const models = Array.isArray(body.supportedModels)
      ? body.supportedModels.filter((m): m is string => typeof m === "string")
      : [];
    const input: CreateChannelInput = {
      name: typeof body.name === "string" ? body.name : "",
      providerType: typeof body.providerType === "string" ? body.providerType : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      weight: typeof body.weight === "number" ? body.weight : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      status: parseStatus(body.status),
      supportedModels: models,
      metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
    };
    const created = await createChannel(input);
    return NextResponse.json({ code: "00000", message: "ok", data: { channel: created } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
