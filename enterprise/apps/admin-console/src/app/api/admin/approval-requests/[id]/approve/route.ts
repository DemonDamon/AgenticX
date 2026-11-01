import { NextResponse } from "next/server";

import { aggregateScopesForUser } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { ApprovalWorkflowError, approveApprovalRequest } from "../../../../../../lib/ecp-approval-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { note?: string };
  const scopes = await aggregateScopesForUser(auth.session.tenantId, auth.session.userId);
  try {
    const item = await approveApprovalRequest({
      requestId: id,
      actorUserId: auth.session.userId,
      actorEmail: auth.session.email,
      actorTenantId: auth.session.tenantId,
      actorScopes: scopes,
      note: body.note,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      const status = error.message.startsWith("forbidden") ? 403 : 400;
      return NextResponse.json({ code: status === 403 ? "40300" : "40000", message: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "approve failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
