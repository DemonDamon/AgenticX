import { NextResponse } from "next/server";
import { requireAdminScope, type AdminSession } from "../../../../../lib/admin-auth";
import { buildPolicyActor, deletePolicyPack, updatePolicyPack } from "../../../../../lib/policy-store";

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    appliesTo?: Record<string, unknown> | null;
  };
  const requiresDisable = body.enabled !== undefined;
  const requiresUpdate =
    body.name !== undefined || body.description !== undefined || body.appliesTo !== undefined;

  if (!requiresDisable && !requiresUpdate) {
    return NextResponse.json({ code: "40000", message: "缺少可更新字段" }, { status: 400 });
  }

  let session: AdminSession | null = null;
  if (requiresDisable) {
    const disableGuard = await requireAdminScope(["policy:disable"]);
    if (!disableGuard.ok) return disableGuard.response;
    session = disableGuard.session;
  }
  if (requiresUpdate) {
    const updateGuard = await requireAdminScope(["policy:update"]);
    if (!updateGuard.ok) return updateGuard.response;
    session = updateGuard.session;
  }
  const { code } = await context.params;
  try {
    if (!session) {
      return NextResponse.json({ code: "40000", message: "权限校验失败" }, { status: 400 });
    }
    const actor = await buildPolicyActor(session);
    const pack = await updatePolicyPack(actor, code, body);
    return NextResponse.json({ code: "00000", message: "ok", data: { pack } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "更新规则包失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ code: string }> }) {
  const guard = await requireAdminScope(["policy:delete"]);
  if (!guard.ok) return guard.response;
  const { code } = await context.params;
  try {
    const actor = await buildPolicyActor(guard.session);
    await deletePolicyPack(actor, code);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "删除规则包失败" },
      { status: 400 }
    );
  }
}
