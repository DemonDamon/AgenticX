import { NextResponse } from "next/server";
import { getAgentVersion } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { agentErrorResponse, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string; version: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId, version } = await context.params;
    if (!/^[1-9]\d{0,8}$/.test(version)) {
      return NextResponse.json({ code: "40000", message: "版本号不合法" }, { status: 400 });
    }
    const row = await getAgentVersion(requiredTenantId(), agentId, Number(version));
    return NextResponse.json({ code: "00000", message: "ok", data: { version: row } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
