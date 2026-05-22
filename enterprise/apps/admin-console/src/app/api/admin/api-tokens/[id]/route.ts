import { NextResponse } from "next/server";
import { revokePat } from "@agenticx/auth";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminScope(["provider:update"]);
    if (!auth.ok) return auth.response;
    const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
    if (!tenantId) {
      return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
    }
    const { id } = await ctx.params;
    const numId = Number(id);
    if (!Number.isFinite(numId)) {
      return NextResponse.json({ code: "40000", message: "invalid id" }, { status: 400 });
    }
    const record = await revokePat(numId, tenantId);
    if (!record) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { record } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "revoke failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
