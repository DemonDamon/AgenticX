import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { buildPolicyActor, rollbackPolicyPublish } from "../../../../../../lib/policy-store";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminScope(["policy:publish"]);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const actor = await buildPolicyActor(guard.session);
    const result = await rollbackPolicyPublish(actor, id);
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "回滚失败" },
      { status: 400 }
    );
  }
}
