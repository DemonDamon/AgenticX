import { NextResponse } from "next/server";
import { deleteAgent, getAgent, updateAgent } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { emitMaResourceEvent } from "../../../../../lib/ma/webhook-events";
import { agentErrorResponse, preparePatchInput, requiredTenantId } from "../shared";

export async function GET(_req: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const agent = await getAgent(requiredTenantId(), agentId);
    return NextResponse.json({ code: "00000", message: "ok", data: { agent } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const agent = await updateAgent(requiredTenantId(), agentId, await preparePatchInput(request));
    return NextResponse.json({ code: "00000", message: "ok", data: { agent } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    await deleteAgent(requiredTenantId(), agentId);
    emitMaResourceEvent({ tenantId: requiredTenantId(), type: "agent.deleted", resourceId: agentId, extra: { agent_id: agentId } });
    return NextResponse.json({ code: "00000", message: "ok", data: { id: agentId } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
