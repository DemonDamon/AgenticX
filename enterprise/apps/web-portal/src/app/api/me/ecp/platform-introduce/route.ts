import { NextResponse } from "next/server";

import { getSessionFromCookies } from "../../../../lib/session";
import {
  ApprovalWorkflowError,
  submitPlatformIntroduceRequest,
} from "../../../../lib/ecp-approval-portal";

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { catalogItemId?: string };
  if (!body.catalogItemId?.trim()) {
    return NextResponse.json({ error: { code: "40000", message: "catalogItemId is required" } }, { status: 400 });
  }
  try {
    const item = await submitPlatformIntroduceRequest({
      tenantId: session.tenantId,
      catalogItemId: body.catalogItemId.trim(),
      requesterUserId: session.userId,
      requesterEmail: session.email,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return NextResponse.json({ error: { code: "40000", message: error.message } }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "submit failed";
    return NextResponse.json({ error: { code: "40000", message } }, { status: 400 });
  }
}
