import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  ApprovalWorkflowError,
  getTenantApprovalSettings,
  upsertTenantApprovalSettings,
} from "../../../../../lib/ecp-approval-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const settings = await getTenantApprovalSettings(auth.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { settings } });
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as {
    skillPublishPresetSlug?: string | null;
    platformIntroducePresetSlug?: string | null;
  };
  try {
    const settings = await upsertTenantApprovalSettings(auth.session.tenantId, body);
    return NextResponse.json({ code: "00000", message: "ok", data: { settings } });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "update failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
