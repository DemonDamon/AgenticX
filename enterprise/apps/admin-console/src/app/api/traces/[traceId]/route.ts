import { NextResponse } from "next/server";
import { requireAdminSomeScope } from "../../../../lib/admin-auth";
import { getAgentTraceSpansByTenant } from "../../../../lib/agent-trace-by-tenant";
import { getDeepResearchRunByTrace } from "../../../../lib/deep-research-trace-query";
import { queryPortalLogs } from "../../../../lib/portal-logs-query";
import { assembleTraceTimeline } from "../../../../lib/trace-timeline";

/** 26-char Crockford Base32 ULID (aligned with portal/sdk-ts isTraceId). */
function isTraceId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const guard = await requireAdminSomeScope(["audit:read:all", "audit:read:dept", "audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }

  const { traceId: raw } = await context.params;
  const traceId = raw?.trim() ?? "";
  if (!isTraceId(traceId)) {
    return NextResponse.json({ code: "40001", message: "invalid trace_id" }, { status: 400 });
  }

  const tenantId = guard.session.tenantId;

  try {
    const [portalResult, modelSpans, deepResearchRun] = await Promise.all([
      queryPortalLogs({
        tenant_id: tenantId,
        trace_id: traceId,
        limit: 100,
        offset: 0,
      }),
      getAgentTraceSpansByTenant(tenantId, traceId),
      getDeepResearchRunByTrace(tenantId, traceId),
    ]);

    const data = assembleTraceTimeline({
      traceId,
      portalLogs: portalResult.items,
      modelSpans,
      deepResearchRun,
    });

    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50002", message, data: undefined }, { status: 500 });
  }
}
