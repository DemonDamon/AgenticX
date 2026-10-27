import { createEvalRubric, listEvalRubrics } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { assertKeys, evalErrorResponse, ok, readAdminJson, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    return ok({ rubrics: await listEvalRubrics(requiredTenantId()) });
  } catch (error) {
    return evalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertKeys(body, ["name", "description", "content"]);
    const rubric = await createEvalRubric(
      requiredTenantId(),
      {
        name: String(body.name ?? ""),
        description: body.description == null ? null : String(body.description),
        content: body.content,
      },
      auth.session.userId,
    );
    return ok({ rubric });
  } catch (error) {
    return evalErrorResponse(error);
  }
}
