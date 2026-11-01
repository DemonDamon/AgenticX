import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  ApprovalWorkflowError,
  submitShelfPublishApprovalRequest,
} from "../../../../../../lib/ecp-approval-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const item = await submitShelfPublishApprovalRequest({
      tenantId: auth.session.tenantId,
      resourceType: "enterprise_skill",
      resourceId: id,
      requesterUserId: auth.session.userId,
      requesterEmail: auth.session.email,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "submit failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
