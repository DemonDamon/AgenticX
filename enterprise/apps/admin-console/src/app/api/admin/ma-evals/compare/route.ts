import { getEvalRun, listEvalResults } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { compareEvalRuns } from "../../../../../lib/ma/eval-compare";
import { toEvalResultView, toEvalRunView } from "../../../../../lib/ma/eval-records";
import { evalErrorResponse, fail, ok, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

function queries(config: Record<string, unknown>): Map<string, string> {
  const dataset = config.dataset;
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return new Map();
  const items = (dataset as { items?: unknown }).items;
  if (!Array.isArray(items)) return new Map();
  const map = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; query?: unknown };
    if (typeof row.id === "string") map.set(row.id, typeof row.query === "string" ? row.query : "");
  }
  return map;
}

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const baseId = url.searchParams.get("base") || "";
    const targetId = url.searchParams.get("target") || "";
    if (!baseId || !targetId) return fail(400, "请选择两次已完成的评测");
    const tenantId = requiredTenantId();
    const [base, target] = await Promise.all([getEvalRun(tenantId, baseId), getEvalRun(tenantId, targetId)]);
    if (!base || !target) return fail(404, "评测任务不存在");
    if (base.status !== "completed" || target.status !== "completed" || base.kind !== "eval" || target.kind !== "eval") {
      return fail(400, "只能对比两次已完成的评测");
    }
    const [baseRows, targetRows] = await Promise.all([
      listEvalResults(tenantId, base.id, { limit: 500 }),
      listEvalResults(tenantId, target.id, { limit: 500 }),
    ]);
    const baseQuery = queries(base.config);
    const targetQuery = queries(target.config);
    const comparison = compareEvalRuns(
      toEvalRunView(base),
      toEvalRunView(target),
      baseRows.map((row) => toEvalResultView(row, baseQuery.get(row.itemId))),
      targetRows.map((row) => toEvalResultView(row, targetQuery.get(row.itemId))),
    );
    return ok({ comparison });
  } catch (error) {
    return evalErrorResponse(error);
  }
}
