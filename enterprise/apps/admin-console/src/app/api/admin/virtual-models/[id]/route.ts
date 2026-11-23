import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { deleteVirtualModel, updateVirtualModel } from "../../../../../lib/virtual-models-store";
import { validateVirtualModelInput } from "../../../../../lib/virtual-models-shared";

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  if (message === "virtual model not found") return 404;
  return 400;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    validateVirtualModelInput(body);
    const virtualModel = await updateVirtualModel(id, body);
    return NextResponse.json({ code: "00000", message: "ok", data: { virtualModel } });
  } catch (error) {
    return NextResponse.json(
      { code: statusFor(error) === 404 ? "40400" : "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: statusFor(error) },
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    await deleteVirtualModel(id);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      { code: statusFor(error) === 404 ? "40400" : "40000", message: error instanceof Error ? error.message : "delete failed" },
      { status: statusFor(error) },
    );
  }
}
