import { NextResponse } from "next/server";
import { assertActorMayManagePatUser, listPats, revokePat } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminScope(["user:update"]);
    if (!auth.ok) return auth.response;
    const tenantId = auth.session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
    }
    const { id } = await ctx.params;
    const numId = Number(id);
    if (!Number.isFinite(numId)) {
      return NextResponse.json({ code: "40000", message: "invalid id" }, { status: 400 });
    }
    const existing = (await listPats({ tenantId })).find((item) => item.id === numId);
    if (!existing) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    await assertActorMayManagePatUser(tenantId, existing.userId, { kind: "user", tenantId, userId: auth.session.userId, scopes: auth.scopes });
    const record = await revokePat(numId, tenantId);
    if (!record) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { record } });
  } catch (error) {
    if (error instanceof Error && error.name === "PrivilegeEscalationError") return NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
    const message = error instanceof Error ? error.message : "revoke failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
