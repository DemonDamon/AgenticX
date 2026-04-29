import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../../lib/admin-auth";
import {
  deleteProviderModel,
  updateProviderModel,
  type ProviderModel,
} from "../../../../../../../lib/model-providers-store";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; modelName: string }> }
) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id, modelName } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Partial<ProviderModel> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (
      Array.isArray(body.capabilities) &&
      body.capabilities.every((c): c is string => typeof c === "string")
    ) {
      patch.capabilities = body.capabilities as string[];
    }
    const updated = updateProviderModel(id, decodeURIComponent(modelName), patch);
    return NextResponse.json({ code: "00000", message: "ok", data: { provider: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "provider not found" || message === "model not found" ? 404 : 400;
    return NextResponse.json(
      { code: status === 404 ? "40400" : "40000", message },
      { status }
    );
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; modelName: string }> }
) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id, modelName } = await context.params;
  try {
    const updated = deleteProviderModel(id, decodeURIComponent(modelName));
    return NextResponse.json({ code: "00000", message: "ok", data: { provider: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "provider not found" || message === "model not found" ? 404 : 400;
    return NextResponse.json(
      { code: status === 404 ? "40400" : "40000", message },
      { status }
    );
  }
}
