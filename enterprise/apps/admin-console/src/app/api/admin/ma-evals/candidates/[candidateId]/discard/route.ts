import { getEvalCandidate } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { runtimeInternal } from "../../../../../../../lib/ma/runtime-internal-client";
import { evalErrorResponse, fail, ok, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { candidateId } = await context.params;
    const tenantId = requiredTenantId();
    const cand = await getEvalCandidate(tenantId, candidateId);
    if (!cand) return fail(404, "候选不存在");
    const result = await runtimeInternal("POST", `/internal/ma/eval-candidates/${candidateId}/status`, {
      tenant_id: tenantId,
      status: "discarded",
      applied_version: null,
      decided_by_user_id: auth.session.userId,
    });
    return ok(result);
  } catch (error) {
    return evalErrorResponse(error);
  }
}
