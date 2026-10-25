import { NextResponse } from "next/server";
import { createAgent, listAgentsWithMa } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { agentErrorResponse, prepareCreateInput, requiredTenantId } from "./shared";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const agents = await listAgentsWithMa(requiredTenantId());
    return NextResponse.json({ code: "00000", message: "ok", data: { agents } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const agent = await createAgent(requiredTenantId(), await prepareCreateInput(request));
    return NextResponse.json({ code: "00000", message: "ok", data: { agent } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
