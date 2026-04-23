import { NextResponse } from "next/server";
import { exportAuditCsv } from "../../../../lib/audit-service";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const result = await exportAuditCsv({
    tenant_id: "tenant_default",
    user_id: typeof body.user_id === "string" ? body.user_id : undefined,
    department_id: typeof body.department_id === "string" ? body.department_id : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    policy_hit: typeof body.policy_hit === "string" ? body.policy_hit : undefined,
    start: typeof body.start === "string" ? body.start : undefined,
    end: typeof body.end === "string" ? body.end : undefined,
    limit: 1000,
    offset: 0,
  });
  return new NextResponse(result.data?.csv ?? "", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-export.csv"`,
    },
  });
}

