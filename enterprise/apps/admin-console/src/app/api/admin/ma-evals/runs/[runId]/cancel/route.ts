import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { runtimeInternal } from "../../../../../../../lib/ma/runtime-internal-client";
import { evalErrorResponse, ok, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { runId } = await context.params;
    const result = await runtimeInternal<{ run: unknown }>("POST", `/internal/ma/eval-runs/${runId}/cancel`, {
      tenant_id: requiredTenantId(),
    });
    return ok(result);
  } catch (error) {
    return evalErrorResponse(error);
  }
}
