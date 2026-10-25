import { getEvalRun, listEvalResults } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toEvalResultView, toEvalRunView } from "../../../../../../lib/ma/eval-records";
import { evalErrorResponse, fail, ok, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { runId } = await context.params;
    const tenantId = requiredTenantId();
    const run = await getEvalRun(tenantId, runId);
    if (!run) return fail(404, "评测任务不存在");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;
    const offset = Number(url.searchParams.get("offset") || "0");
    const limit = Number(url.searchParams.get("limit") || "100");
    const results = await listEvalResults(tenantId, runId, { status, offset, limit });
    const items = Array.isArray(run.config.dataset) ? [] : datasetItems(run.config);
    const queryById = new Map(items.map((item) => [item.id, item.query]));
    return ok({
      run: toEvalRunView(run),
      results: results.map((row) => toEvalResultView(row, queryById.get(row.itemId))),
    });
  } catch (error) {
    return evalErrorResponse(error);
  }
}

function datasetItems(config: Record<string, unknown>): Array<{ id: string; query: string }> {
  const dataset = config.dataset;
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return [];
  const items = (dataset as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; query?: unknown };
    if (typeof row.id !== "string") return [];
    return [{ id: row.id, query: typeof row.query === "string" ? row.query : "" }];
  });
}
