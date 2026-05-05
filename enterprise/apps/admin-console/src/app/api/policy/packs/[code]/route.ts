import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { buildPolicyActor, deletePolicyPack, updatePolicyPack } from "../../../../../lib/policy-store";

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    appliesTo?: Record<string, unknown> | null;
  };
  const guard =
    body.enabled !== undefined
      ? await requireAdminScope(["policy:disable"])
      : await requireAdminScope(["policy:update"]);
  if (!guard.ok) return guard.response;
  const { code } = await context.params;
  try {
    const actor = await buildPolicyActor(guard.session);
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
