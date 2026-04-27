import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/admin-auth";
import {
  deleteProvider,
  getProvider,
  updateProvider,
  type ProviderRoute,
  type UpdateProviderInput,
} from "../../../../../lib/model-providers-store";

function parseRoute(value: unknown): ProviderRoute | undefined {
  if (value === "local" || value === "private-cloud" || value === "third-party") return value;
  return undefined;
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok", data: { provider } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: UpdateProviderInput = {};
    if (typeof body.displayName === "string") patch.displayName = body.displayName;
    if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
    if (typeof body.apiKey === "string") patch.apiKey = body.apiKey;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.isDefault === "boolean") patch.isDefault = body.isDefault;
    if (typeof body.envKey === "string") patch.envKey = body.envKey;
    const route = parseRoute(body.route);
    if (route) patch.route = route;

    const updated = updateProvider(id, patch);
    return NextResponse.json({ code: "00000", message: "ok", data: { provider: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "provider not found" ? 404 : 400;
    return NextResponse.json(
      { code: status === 404 ? "40400" : "40000", message },
      { status }
    );
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const ok = deleteProvider(id);
  if (!ok) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok" });
}
