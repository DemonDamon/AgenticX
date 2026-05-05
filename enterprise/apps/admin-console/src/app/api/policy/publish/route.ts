import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { buildPolicyActor, publishPolicy } from "../../../../lib/policy-store";

export async function POST(req: Request) {
  const guard = await requireAdminScope(["policy:publish"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { activateDraftRuleIds?: string[] };
  const activateDraftRuleIds = Array.isArray(body.activateDraftRuleIds)
    ? body.activateDraftRuleIds.filter((id): id is string => typeof id === "string")
    : undefined;
  try {
    const actor = await buildPolicyActor(guard.session);
    const result = await publishPolicy(actor, activateDraftRuleIds);
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "发布失败" },
      { status: 400 }
    );
  }
}
