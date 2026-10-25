import { deleteEvalRubric, listEvalRubrics, updateEvalRubric } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { assertKeys, evalErrorResponse, ok, readAdminJson, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ rubricId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { rubricId } = await context.params;
    const rubric = (await listEvalRubrics(requiredTenantId())).find((item) => item.id === rubricId);
    if (!rubric) return evalErrorResponse(Object.assign(new Error("评分标准不存在"), { name: "EvalRubricNotFoundError" }));
    return ok({ rubric });
  } catch (error) {
    return evalErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ rubricId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { rubricId } = await context.params;
    const body = await readAdminJson(request);
    assertKeys(body, ["name", "description", "content"]);
    const rubric = await updateEvalRubric(requiredTenantId(), rubricId, {
      ...(body.name === undefined ? {} : { name: String(body.name) }),
      ...(body.description === undefined ? {} : { description: body.description == null ? null : String(body.description) }),
      ...(body.content === undefined ? {} : { content: body.content }),
    });
    return ok({ rubric });
  } catch (error) {
    return evalErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ rubricId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { rubricId } = await context.params;
    await deleteEvalRubric(requiredTenantId(), rubricId);
    return ok({ deleted: true });
  } catch (error) {
    return evalErrorResponse(error);
  }
}
