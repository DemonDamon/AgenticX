import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { runtimeInternal } from "../../../../../../../lib/ma/runtime-internal-client";
import { assertKeys, evalErrorResponse, fail, ok, readAdminJson, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

const MODEL_RE = /^[^/\s]+\/\S+$/;

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { runId } = await context.params;
    const body = await readAdminJson(request);
    assertKeys(body, ["optimizer_model"]);
    const model = typeof body.optimizer_model === "string" ? body.optimizer_model.trim() : "";
    if (!MODEL_RE.test(model)) return fail(400, "请选择优化模型");
    const result = await runtimeInternal<{ run: unknown }>("POST", "/internal/ma/eval-iterations", {
      tenant_id: requiredTenantId(),
      created_by_user_id: auth.session.userId,
      base_run_id: runId,
      optimizer_model: model,
    });
    return ok(result, 201);
  } catch (error) {
    return evalErrorResponse(error);
  }
}
