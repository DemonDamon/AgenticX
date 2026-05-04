import { NextResponse } from "next/server";
import {
  buildAuditActor,
  exportAuditCsv,
  insertGatewayAuditExportEvent,
} from "../../../../lib/audit-service";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { takeToken } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const guard = await requireAdminScope(["audit:export"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }

  const actor = await buildAuditActor(guard.session, guard.scopes);
  const rateKey = `audit-export:${actor.tenantId}:${actor.userId}`;
  if (!takeToken(rateKey, 3, 60_000)) {
    return NextResponse.json({ code: "42900", message: "export rate limited (max 3/min per user)" }, { status: 429 });
  }

  const input = {
    tenant_id: guard.session.tenantId,
    user_id: typeof body.user_id === "string" ? body.user_id : undefined,
    department_id: typeof body.department_id === "string" ? body.department_id : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    policy_hit: typeof body.policy_hit === "string" ? body.policy_hit : undefined,
    start: typeof body.start === "string" ? body.start : undefined,
    end: typeof body.end === "string" ? body.end : undefined,
    limit: 1000,
    offset: 0,
  };

  let result;
  try {
    result = await exportAuditCsv(actor, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50002", message }, { status: 500 });
  }

  const csv = result.data?.csv ?? "";

  try {
    await insertGatewayAuditExportEvent(actor, { filters: input });
  } catch {
    /* self-audit failure must not block download */
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-export.csv"`,
    },
  });
}
