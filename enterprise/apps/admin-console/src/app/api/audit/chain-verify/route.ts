import { NextResponse } from "next/server";
import { buildAuditActor, verifyGatewayAuditChain } from "../../../../lib/audit-service";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET() {
  const guard = await requireAdminScope(["audit:read:all"]);
  if (!guard.ok) {
    return guard.response;
  }
  try {
    const actor = await buildAuditActor(guard.session, guard.scopes);
    const data = await verifyGatewayAuditChain(actor, guard.session.tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50002", message, data: undefined }, { status: 500 });
  }
}
