import { listEvalCandidates } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toEvalCandidateView } from "../../../../../lib/ma/eval-records";
import { evalErrorResponse, ok, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const agentId = new URL(request.url).searchParams.get("agent_id") || undefined;
    const rows = await listEvalCandidates(requiredTenantId(), agentId ? { agentId } : undefined);
    return ok({ candidates: rows.map(toEvalCandidateView) });
  } catch (error) {
    return evalErrorResponse(error);
  }
}
