import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { buildPolicyActor, createPolicyPack, listPolicyPacks } from "../../../../lib/policy-store";

export async function GET() {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  const packs = await listPolicyPacks(guard.session.tenantId);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { packs },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdminScope(["policy:create"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    name?: string;
    description?: string | null;
    enabled?: boolean;
    appliesTo?: Record<string, unknown> | null;
  };
  if (!body.code || !body.name) {
    return NextResponse.json({ code: "40000", message: "code 与 name 为必填项" }, { status: 400 });
  }
  try {
    const actor = await buildPolicyActor(guard.session);
    const pack = await createPolicyPack(actor, {
      code: body.code,
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      appliesTo: body.appliesTo,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { pack },
    });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "创建规则包失败" },
      { status: 500 }
    );
  }
}
