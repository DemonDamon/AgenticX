import { NextResponse } from "next/server";
import { queryAudit } from "../../../../lib/audit-service";
import { requireAdminSession } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  const guard = await requireAdminSession();
  if (!guard.ok) {
    return guard.response;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  try {
    const result = await queryAudit({
      tenant_id: "tenant_default",
      user_id: typeof body.user_id === "string" ? body.user_id : undefined,
      department_id: typeof body.department_id === "string" ? body.department_id : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      policy_hit: typeof body.policy_hit === "string" ? body.policy_hit : undefined,
      start: typeof body.start === "string" ? body.start : undefined,
      end: typeof body.end === "string" ? body.end : undefined,
      limit: typeof body.limit === "number" ? body.limit : 100,
      offset: typeof body.offset === "number" ? body.offset : 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { code: "50002", message, data: undefined },
      { status: 500 }
    );
  }
}

