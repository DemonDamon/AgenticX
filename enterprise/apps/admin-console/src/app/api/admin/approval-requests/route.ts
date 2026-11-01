import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  ApprovalWorkflowError,
  listApprovalRequests,
  submitPlatformIntroduceRequest,
  submitShelfPublishApprovalRequest,
} from "../../../../lib/ecp-approval-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const items = await listApprovalRequests({
    tenantId: auth.session.tenantId,
    status: status as "pending" | "approved" | "rejected" | "cancelled" | undefined,
  });
  return NextResponse.json({ code: "00000", message: "ok", data: { items } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    catalogItemId?: string;
    contextJson?: Record<string, unknown>;
  };
  try {
    if (body.action === "platform_introduce" && body.catalogItemId) {
      const item = await submitPlatformIntroduceRequest({
        tenantId: auth.session.tenantId,
        catalogItemId: body.catalogItemId,
        requesterUserId: auth.session.userId,
        requesterEmail: auth.session.email,
        contextJson: body.contextJson,
      });
      return NextResponse.json({ code: "00000", message: "ok", data: { item } });
    }
    if (
      body.action === "shelf_publish" &&
      body.resourceType &&
      body.resourceId &&
      (body.resourceType === "enterprise_skill" || body.resourceType === "platform_catalog_version")
    ) {
      const item = await submitShelfPublishApprovalRequest({
        tenantId: auth.session.tenantId,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        requesterUserId: auth.session.userId,
        requesterEmail: auth.session.email,
        contextJson: body.contextJson,
      });
      return NextResponse.json({ code: "00000", message: "ok", data: { item } });
    }
    return NextResponse.json({ code: "40000", message: "invalid approval request payload" }, { status: 400 });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "create failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
