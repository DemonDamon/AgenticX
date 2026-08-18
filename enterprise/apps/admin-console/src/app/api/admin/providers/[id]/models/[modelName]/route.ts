import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { normalizeContextWindow } from "../../../../../../../lib/model-context-window";
import {
  deleteProviderModel,
  updateProviderModel,
  type ProviderModelPatch,
} from "../../../../../../../lib/model-providers-store";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; modelName: string }> }
) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id, modelName } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: ProviderModelPatch = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (
      Array.isArray(body.capabilities) &&
      body.capabilities.every((c): c is string => typeof c === "string")
    ) {
      patch.capabilities = body.capabilities as string[];
    }
    // 显式 null / 空串 = 清除声明值回到自动识别；非法数字按未提供处理，不覆盖已存值。
    if (body.contextWindow === null || body.contextWindow === "") {
      patch.contextWindow = null;
    } else if (body.contextWindow !== undefined) {
      const declared = normalizeContextWindow(body.contextWindow);
      if (declared === undefined) throw new Error("contextWindow out of range");
      patch.contextWindow = declared;
    }
    const updated = await updateProviderModel(id, decodeURIComponent(modelName), patch);
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
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id, modelName } = await context.params;
  try {
    const updated = await deleteProviderModel(id, decodeURIComponent(modelName));
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
