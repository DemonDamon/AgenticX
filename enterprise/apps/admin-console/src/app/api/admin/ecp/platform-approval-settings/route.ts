import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  ApprovalWorkflowError,
  getPlatformApprovalSettings,
  upsertPlatformApprovalSettings,
} from "../../../../../lib/ecp-approval-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const settings = await getPlatformApprovalSettings();
  return NextResponse.json({ code: "00000", message: "ok", data: { settings } });
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as {
    catalogPublishPresetSlug?: string | null;
  };
  try {
    const settings = await upsertPlatformApprovalSettings(body);
    return NextResponse.json({ code: "00000", message: "ok", data: { settings } });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "update failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
